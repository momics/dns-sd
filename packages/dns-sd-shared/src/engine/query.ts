/**
 * The browse state machine (RFC 6762 continuous querying + RFC 6763 service
 * resolution). Sends PTR queries with exponential back-off and known-answer
 * suppression, resolves each discovered instance's SRV / TXT / A / AAAA
 * records, and emits {@link ServiceAnnouncement} events.
 *
 * @module
 */

import {
  DnsClass,
  type DnsMessage,
  isA,
  isAAAA,
  isPTR,
  isSRV,
  isTXT,
  type ResourceRecord,
  ResourceType,
} from "../wire/types.ts";
import type { ServiceAnnouncement } from "../types.ts";
import {
  nameKey,
  parseServiceName,
  serviceTypeLabels,
  subtypeServiceLabels,
} from "../naming.ts";
import { txtFromAttributes } from "../txt.ts";
import { FastFIFO } from "../fast_fifo.ts";
import type { EngineTiming } from "./constants.ts";
import { RecordCache } from "./cache.ts";

/** A question the browser is interested in. */
interface Question {
  name: string[];
  type: ResourceType;
}

interface InstanceState {
  fullName: string;
  labels: string[];
  serviceType: string;
  protocol: "tcp" | "udp";
  domain: string;
  subtypes: string[];
  port: number | null;
  targetKey: string | null;
  txt: ServiceAnnouncement["txt"];
  resolved: boolean;
}

interface TargetState {
  labels: string[];
  addresses: Set<string>;
  instances: Set<string>;
}

/** The connection a browser needs back into the engine. */
export interface BrowseContext {
  timing: EngineTiming;
  send(message: DnsMessage): void;
  /** Register/unregister this browser to receive decoded messages. */
  register(browser: Browser): void;
  unregister(browser: Browser): void;
}

export class Browser {
  private readonly ctx: BrowseContext;
  private readonly serviceLabels: string[];
  private readonly serviceKey: string;
  private readonly output = new FastFIFO<ServiceAnnouncement>();
  private readonly cache: RecordCache;
  private readonly instances = new Map<string, InstanceState>();
  private readonly targets = new Map<string, TargetState>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private suppressNextQuery = false;
  private closed = false;

  constructor(
    ctx: BrowseContext,
    spec: {
      type: string;
      protocol: "tcp" | "udp";
      domain: string;
      subtypes?: string[];
    },
  ) {
    this.ctx = ctx;
    const subtype = spec.subtypes?.[0];
    this.serviceLabels = subtype
      ? subtypeServiceLabels(subtype, spec.type, spec.protocol, spec.domain)
      : serviceTypeLabels(spec.type, spec.protocol, spec.domain);
    this.serviceKey = nameKey(this.serviceLabels);

    this.cache = new RecordCache({
      timing: ctx.timing,
      onRequery: (record) =>
        this.sendQuery([{ name: record.name, type: record.type }]),
      emit: (event) => this.onCacheEvent(event.kind, event.record),
    });

    ctx.register(this);
    this.scheduleInitialQuery();
  }

  /** The async stream of discovery events. */
  events(): AsyncIterable<ServiceAnnouncement> {
    return this.output;
  }

  // ── Query scheduling ───────────────────────────────────────────────────────

  private schedule(delayMs: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.closed) fn();
    }, delayMs);
    this.timers.add(timer);
  }

  private scheduleInitialQuery(): void {
    const t = this.ctx.timing;
    const delay = t.initialQueryMinMs +
      Math.random() * (t.initialQueryMaxMs - t.initialQueryMinMs);
    this.schedule(delay, () => {
      this.sendPtrQuery();
      this.scheduleNextQuery(t.queryIntervalStartMs);
    });
  }

  private scheduleNextQuery(intervalMs: number): void {
    this.schedule(intervalMs, () => {
      this.sendPtrQuery();
      this.scheduleNextQuery(
        Math.min(intervalMs * 2, this.ctx.timing.queryIntervalMaxMs),
      );
    });
  }

  private sendPtrQuery(): void {
    if (this.suppressNextQuery) {
      this.suppressNextQuery = false;
      return;
    }
    this.sendQuery([{ name: this.serviceLabels, type: ResourceType.PTR }]);
  }

  private sendQuery(questions: Question[]): void {
    if (this.closed || questions.length === 0) return;

    // Known-answer suppression (RFC 6762 §7.1): include shared records we
    // already hold so responders can suppress duplicate answers.
    const knownAnswers: ResourceRecord[] = [];
    for (const q of questions) {
      if (q.type === ResourceType.PTR) {
        for (
          const rec of this.cache.knownAnswers(nameKey(q.name) + "|" + q.type)
        ) {
          knownAnswers.push(rec);
        }
      }
    }

    this.ctx.send({
      header: emptyQueryHeader(),
      questions: questions.map((q) => ({
        name: q.name,
        type: q.type,
        class: DnsClass.IN,
        unicastResponse: false,
      })),
      answers: knownAnswers,
      authorities: [],
      additionals: [],
    });
  }

  // ── Incoming messages ────────────────────────────────────────────────────────

  /** Called by the engine for every decoded response. */
  onResponse(message: DnsMessage): void {
    if (this.closed) return;
    const all = [...message.answers, ...message.additionals];

    // Pass 1: PTR records for our service type discover instances.
    for (const rec of all) {
      if (isPTR(rec) && nameKey(rec.name) === this.serviceKey) {
        this.cache.add(rec);
      }
    }
    // Pass 2: SRV / TXT for known instances.
    for (const rec of all) {
      if (
        (isSRV(rec) || isTXT(rec)) && this.instances.has(nameKey(rec.name))
      ) {
        this.cache.add(rec);
      }
    }
    // Pass 3: A / AAAA for known targets.
    for (const rec of all) {
      if ((isA(rec) || isAAAA(rec)) && this.targets.has(nameKey(rec.name))) {
        this.cache.add(rec);
      }
    }
  }

  /** Called by the engine for every decoded query (for question suppression). */
  onQuery(message: DnsMessage): void {
    if (this.closed) return;
    // RFC 6762 §7.3: if another host just asked our exact question, suppress
    // our next scheduled duplicate. Only when their known-answer list is empty.
    if (message.answers.length > 0) return;
    for (const q of message.questions) {
      if (
        q.type === ResourceType.PTR && nameKey(q.name) === this.serviceKey
      ) {
        this.suppressNextQuery = true;
      }
    }
  }

  // ── Cache-driven resolution ──────────────────────────────────────────────────

  private onCacheEvent(
    kind: "added" | "updated" | "removed",
    record: ResourceRecord,
  ): void {
    if (isPTR(record) && nameKey(record.name) === this.serviceKey) {
      if (kind === "removed") this.removeInstance(nameKey(record.data.name));
      else this.discoverInstance(record.data.name);
    } else if (isSRV(record)) {
      this.onSrv(record, kind);
    } else if (isTXT(record)) {
      this.onTxt(record, kind);
    } else if (isA(record) || isAAAA(record)) {
      this.onAddress(record, kind);
    }
  }

  private discoverInstance(labels: string[]): void {
    const key = nameKey(labels);
    if (this.instances.has(key)) return;
    const parsed = parseServiceName(labels);
    const instance: InstanceState = {
      fullName: labels.join("."),
      labels,
      serviceType: parsed?.serviceType ?? "",
      protocol: parsed?.protocol ?? "tcp",
      domain: parsed?.domain ?? "local",
      subtypes: parsed?.subtypes ?? [],
      port: null,
      targetKey: null,
      txt: {},
      resolved: false,
    };
    this.instances.set(key, instance);
    this.emit(instance, "found");
    // Resolve it: ask for SRV and TXT.
    this.sendQuery([
      { name: labels, type: ResourceType.SRV },
      { name: labels, type: ResourceType.TXT },
    ]);
  }

  private removeInstance(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;
    this.instances.delete(key);
    if (instance.targetKey) {
      this.targets.get(instance.targetKey)?.instances.delete(key);
    }
    this.emit(instance, "removed");
  }

  private onSrv(record: ResourceRecord, kind: string): void {
    if (!isSRV(record)) return;
    const key = nameKey(record.name);
    const instance = this.instances.get(key);
    if (!instance) return;

    if (kind === "removed") {
      instance.port = null;
      if (instance.targetKey) {
        this.targets.get(instance.targetKey)?.instances.delete(key);
        instance.targetKey = null;
      }
      return;
    }

    instance.port = record.data.port;
    const targetKey = nameKey(record.data.target);
    if (instance.targetKey !== targetKey) {
      if (instance.targetKey) {
        this.targets.get(instance.targetKey)?.instances.delete(key);
      }
      instance.targetKey = targetKey;
      let target = this.targets.get(targetKey);
      if (!target) {
        target = {
          labels: record.data.target,
          addresses: new Set(),
          instances: new Set(),
        };
        this.targets.set(targetKey, target);
      }
      target.instances.add(key);
      // Ask for the host's address records.
      this.sendQuery([
        { name: record.data.target, type: ResourceType.A },
        { name: record.data.target, type: ResourceType.AAAA },
      ]);
    }
    this.markResolved(instance);
  }

  private onTxt(record: ResourceRecord, kind: string): void {
    if (!isTXT(record)) return;
    const instance = this.instances.get(nameKey(record.name));
    if (!instance) return;
    instance.txt = kind === "removed"
      ? {}
      : txtFromAttributes(record.data.attributes);
    if (instance.resolved) this.emit(instance, "updated");
  }

  private onAddress(record: ResourceRecord, kind: string): void {
    const key = nameKey(record.name);
    const target = this.targets.get(key);
    if (!target) return;
    const address = isA(record)
      ? record.data.address.join(".")
      : (isAAAA(record) ? record.data.address : null);
    if (address === null) return;

    if (kind === "removed") target.addresses.delete(address);
    else target.addresses.add(address);

    for (const instKey of target.instances) {
      const instance = this.instances.get(instKey);
      if (!instance) continue;
      if (instance.resolved) this.emit(instance, "updated");
      else this.markResolved(instance);
    }
  }

  private markResolved(instance: InstanceState): void {
    // Resolved once host, port and at least one address are known.
    const target = instance.targetKey
      ? this.targets.get(instance.targetKey)
      : undefined;
    const hasAddress = target !== undefined && target.addresses.size > 0;
    if (instance.port !== null && instance.targetKey !== null && hasAddress) {
      const firstTime = !instance.resolved;
      instance.resolved = true;
      this.emit(instance, firstTime ? "resolved" : "updated");
    }
  }

  private emit(
    instance: InstanceState,
    kind: ServiceAnnouncement["kind"],
  ): void {
    const target = instance.targetKey
      ? this.targets.get(instance.targetKey)
      : undefined;
    const host = target ? target.labels.join(".") : null;
    const addresses = target ? Array.from(target.addresses) : [];
    this.output.push({
      kind,
      name: instance.labels[0] ?? instance.fullName,
      fullName: instance.fullName,
      serviceType: instance.serviceType,
      protocol: instance.protocol,
      domain: instance.domain,
      subtypes: instance.subtypes,
      host: kind === "found" ? null : host,
      port: kind === "found" ? null : instance.port,
      addresses: kind === "found" ? [] : addresses,
      txt: instance.txt,
      isActive: kind !== "removed",
      lastSeenMs: Date.now(),
    });
  }

  /** Stop the browser and release resources. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.cache.close();
    this.ctx.unregister(this);
    this.output.close();
  }
}

function emptyQueryHeader(): DnsMessage["header"] {
  return {
    id: 0,
    isResponse: false,
    opcode: 0,
    authoritative: false,
    truncated: false,
    recursionDesired: false,
    recursionAvailable: false,
    rcode: 0,
  };
}
