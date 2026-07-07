/**
 * The advertise state machine: the full RFC 6762 lifecycle of probing (§8.1),
 * announcing (§8.3), conflict resolution (§9) and goodbye (§10.1), plus
 * answering queries for the records we're authoritative for (§6).
 *
 * @module
 */

import {
  DnsClass,
  type DnsMessage,
  isA,
  isAAAA,
  type ResourceRecord,
  ResourceType,
} from "../wire/types.ts";
import type { AdvertiseServiceSpec } from "../types.ts";
import {
  instanceNameLabels,
  nameKey,
  namesEqual,
  SERVICE_TYPE_ENUMERATION,
  serviceTypeLabels,
  subtypeServiceLabels,
} from "../naming.ts";
import { encodeTxtInput } from "../txt.ts";
import type { EngineTiming } from "./constants.ts";
import { TTL_HOST, TTL_SHARED } from "./constants.ts";
import { compareRdata, recordSort } from "./records.ts";

/** The connection a responder needs back into the engine. */
export interface ResponderContext {
  timing: EngineTiming;
  family: "IPv4" | "IPv6";
  hostname: string;
  localAddresses(): string[];
  send(message: DnsMessage): void;
  register(responder: Responder): void;
  unregister(responder: Responder): void;
}

const MAX_RENAME_ATTEMPTS = 20;

export class Responder {
  private readonly ctx: ResponderContext;
  private readonly spec: AdvertiseServiceSpec;
  private readonly domain: string;
  private readonly baseName: string;
  private readonly hostLabels: string[];
  private readonly addressRecords: ResourceRecord[];

  private instanceName: string;
  private records: ResourceRecord[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private renameAttempt = 0;
  private probeConflict = false;
  private started = false;
  private closed = false;

  // ── Response aggregation (RFC 6762 §6) ─────────────────────────────────────
  /** Answers buffered for the current aggregation window (record references). */
  private pendingAnswers: ResourceRecord[] = [];
  /** The single pending-flush timer, or null when no window is open. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private ready!: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;

  constructor(ctx: ResponderContext, spec: AdvertiseServiceSpec) {
    this.ctx = ctx;
    this.spec = spec;
    this.domain = spec.domain ?? "local";
    this.baseName = spec.name;
    this.instanceName = spec.name;

    const host = spec.host ?? defaultHostLabel(ctx.hostname, this.domain);
    this.hostLabels = host.split(".");
    this.addressRecords = this.buildAddressRecords();

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  /** The final instance name currently claimed. */
  get name(): string {
    return this.instanceName;
  }

  /** The final fully-qualified instance name. */
  get fullName(): string {
    return [this.instanceName, ...this.serviceLabels()].join(".");
  }

  /** Start the probe→announce lifecycle; resolves once the name is claimed. */
  start(): Promise<void> {
    if (!this.started) {
      this.started = true;
      this.ctx.register(this);
      this.rebuildRecords();
      this.beginProbe();
    }
    return this.ready;
  }

  private serviceLabels(): string[] {
    return serviceTypeLabels(this.spec.type, this.spec.protocol, this.domain);
  }

  private instanceLabels(): string[] {
    return instanceNameLabels(
      this.instanceName,
      this.spec.type,
      this.spec.protocol,
      this.domain,
    );
  }

  private buildAddressRecords(): ResourceRecord[] {
    const addresses = this.spec.host ? [] : this.ctx.localAddresses();
    const records: ResourceRecord[] = [];
    if (this.ctx.family === "IPv4") {
      const v4 = addresses.filter((a) => a.includes(".") && !a.includes(":"));
      const chosen = v4.length > 0 ? v4 : ["127.0.0.1"];
      for (const addr of chosen) {
        records.push({
          name: this.hostLabels,
          type: ResourceType.A,
          class: DnsClass.IN,
          ttl: TTL_HOST,
          flush: true,
          data: {
            kind: "A",
            address: addr.split(".").map((n) => parseInt(n, 10)),
          },
        });
      }
    } else {
      const v6 = addresses.filter((a) => a.includes(":"));
      const chosen = v6.length > 0 ? v6 : ["::1"];
      for (const addr of chosen) {
        records.push({
          name: this.hostLabels,
          type: ResourceType.AAAA,
          class: DnsClass.IN,
          ttl: TTL_HOST,
          flush: true,
          data: { kind: "AAAA", address: addr },
        });
      }
    }
    return records;
  }

  private rebuildRecords(): void {
    const instance = this.instanceLabels();
    const service = this.serviceLabels();

    const ptr: ResourceRecord = {
      name: service,
      type: ResourceType.PTR,
      class: DnsClass.IN,
      ttl: TTL_SHARED,
      flush: false,
      data: { kind: "PTR", name: instance },
    };

    const srv: ResourceRecord = {
      name: instance,
      type: ResourceType.SRV,
      class: DnsClass.IN,
      ttl: TTL_HOST,
      flush: true,
      data: {
        kind: "SRV",
        priority: 0,
        weight: 0,
        port: this.spec.port,
        target: this.hostLabels,
      },
    };

    const txt: ResourceRecord = {
      name: instance,
      type: ResourceType.TXT,
      class: DnsClass.IN,
      ttl: TTL_HOST,
      flush: true,
      data: { kind: "TXT", attributes: encodeTxtInput(this.spec.txt) },
    };

    const enumeration: ResourceRecord = {
      name: SERVICE_TYPE_ENUMERATION.split("."),
      type: ResourceType.PTR,
      class: DnsClass.IN,
      ttl: TTL_SHARED,
      flush: false,
      data: { kind: "PTR", name: service },
    };

    const subtypePtrs: ResourceRecord[] = (this.spec.subtypes ?? []).map(
      (subtype) => ({
        name: subtypeServiceLabels(
          subtype,
          this.spec.type,
          this.spec.protocol,
          this.domain,
        ),
        type: ResourceType.PTR,
        class: DnsClass.IN,
        ttl: TTL_SHARED,
        flush: false,
        data: { kind: "PTR", name: instance },
      }),
    );

    this.records = [
      ptr,
      srv,
      txt,
      ...this.addressRecords,
      enumeration,
      ...subtypePtrs,
    ];
  }

  /** Records that must be unique on the network (the ones we probe/defend). */
  private uniqueRecords(): ResourceRecord[] {
    return this.records.filter((r) => r.flush);
  }

  // ── Probing ──────────────────────────────────────────────────────────────────

  private beginProbe(): void {
    this.probeConflict = false;
    const delay = Math.random() * this.ctx.timing.probeDelayMaxMs;
    let sent = 0;
    const sendProbe = (): void => {
      if (this.closed) return;
      this.ctx.send(this.buildProbeMessage());
      sent++;
      if (sent >= this.ctx.timing.probeCount) {
        this.schedule(
          this.ctx.timing.probeIntervalMs,
          () => this.onProbeDone(),
        );
        return;
      }
      this.schedule(this.ctx.timing.probeIntervalMs, sendProbe);
    };
    this.schedule(delay, sendProbe);
  }

  private onProbeDone(): void {
    if (this.closed) return;
    if (this.probeConflict) {
      this.rename();
      return;
    }
    this.announce();
    this.resolveReady();
  }

  private buildProbeMessage(): DnsMessage {
    const names = this.uniqueNames();
    return {
      header: queryHeader(),
      questions: names.map((name) => ({
        name,
        type: ResourceType.ANY,
        class: DnsClass.IN,
        // Probe queries request unicast responses (RFC 6762 §8.1).
        unicastResponse: true,
      })),
      answers: [],
      // Proposed records go in the authority section for tie-breaking.
      authorities: this.uniqueRecords(),
      additionals: [],
    };
  }

  private uniqueNames(): string[][] {
    const seen = new Set<string>();
    const names: string[][] = [];
    for (const r of this.uniqueRecords()) {
      const key = nameKey(r.name);
      if (!seen.has(key)) {
        seen.add(key);
        names.push(r.name);
      }
    }
    return names;
  }

  private rename(): void {
    this.renameAttempt++;
    if (this.renameAttempt > MAX_RENAME_ATTEMPTS) {
      this.rejectReady(
        new Error(
          `could not claim a unique name for "${this.baseName}" after ` +
            `${MAX_RENAME_ATTEMPTS} attempts`,
        ),
      );
      this.close();
      return;
    }
    this.instanceName = `${this.baseName} (${this.renameAttempt + 1})`;
    this.rebuildRecords();
    this.beginProbe();
  }

  // ── Announcing ───────────────────────────────────────────────────────────────

  private announce(): void {
    this.announcing = true;
    let sent = 0;
    const send = (): void => {
      if (this.closed) return;
      this.ctx.send(this.buildAnnounceMessage());
      sent++;
      if (sent < this.ctx.timing.announceCount) {
        this.schedule(this.ctx.timing.announceIntervalMs, send);
      }
    };
    send();
  }

  private buildAnnounceMessage(): DnsMessage {
    return {
      header: responseHeader(),
      questions: [],
      answers: this.records,
      authorities: [],
      additionals: [],
    };
  }

  // ── Incoming messages ─────────────────────────────────────────────────────────

  /** Called by the engine for every decoded query. */
  onQuery(message: DnsMessage): void {
    if (this.closed || !this.ready) return;

    // Another host probing for one of our names while we probe → tie-break.
    if (message.authorities.length > 0 && !this.resolvedReady()) {
      if (this.losesTieBreak(message.authorities)) {
        this.probeConflict = true;
      }
      return;
    }

    // Answer questions we're authoritative for (only once announcing).
    if (!this.resolvedReady()) return;
    const answers = this.answersFor(message);
    if (answers.length === 0) return;

    // A probe query (proposed records in the Authority Section) demands an
    // immediate defensive response (RFC 6762 §6: probes time out in ~250ms),
    // so it must bypass the aggregation window.
    if (message.authorities.length > 0) {
      this.sendAnswers(answers);
      return;
    }

    // Otherwise buffer the answers and flush after a random aggregation delay
    // so that answers accumulated within one window coalesce into a single
    // response (RFC 6762 §6).
    this.bufferAnswers(answers);
  }

  /** Send a set of answers plus their additionals as one response. */
  private sendAnswers(answers: ResourceRecord[]): void {
    this.ctx.send({
      header: responseHeader(),
      questions: [],
      answers,
      authorities: [],
      additionals: this.additionalsFor(answers),
    });
  }

  /** Add answers to the pending window, opening a flush timer if needed. */
  private bufferAnswers(answers: ResourceRecord[]): void {
    for (const answer of answers) {
      if (!this.pendingAnswers.includes(answer)) {
        this.pendingAnswers.push(answer);
      }
    }
    if (this.flushTimer !== null) return;
    const { responseAggregationMinMs: min, responseAggregationMaxMs: max } =
      this.ctx.timing;
    const delay = min + Math.random() * Math.max(0, max - min);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.flushTimer = null;
      if (!this.closed) this.flushAnswers();
    }, delay);
    this.timers.add(timer);
    this.flushTimer = timer;
  }

  /** Send all buffered answers as one aggregated response. */
  private flushAnswers(): void {
    const answers = this.pendingAnswers;
    this.pendingAnswers = [];
    if (this.closed || answers.length === 0) return;
    this.sendAnswers(answers);
  }

  /** Called by the engine for every decoded response. */
  onResponse(message: DnsMessage): void {
    if (this.closed) return;
    for (const answer of message.answers) {
      for (const ours of this.uniqueRecords()) {
        if (
          nameKey(answer.name) === nameKey(ours.name) &&
          answer.type === ours.type
        ) {
          if (compareRdata(answer, ours) !== 0) {
            // A conflicting unique record from another host.
            if (!this.resolvedReady()) {
              this.probeConflict = true;
            } else {
              // Steady-state conflict: defend by re-probing under a new name.
              this.reprobe();
            }
            return;
          }
        }
      }
    }
  }

  private answersFor(message: DnsMessage): ResourceRecord[] {
    const answers: ResourceRecord[] = [];
    for (const q of message.questions) {
      for (const rec of this.records) {
        const typeMatch = q.type === ResourceType.ANY || q.type === rec.type;
        if (!typeMatch || !namesEqual(q.name, rec.name)) continue;
        // Known-answer suppression (RFC 6762 §7.1).
        const suppressed = message.answers.some((known) =>
          known.type === rec.type &&
          namesEqual(known.name, rec.name) &&
          compareRdata(known, rec) === 0 &&
          known.ttl >= rec.ttl / 2
        );
        if (!suppressed && !answers.includes(rec)) answers.push(rec);
      }
    }
    return answers;
  }

  private additionalsFor(answers: ResourceRecord[]): ResourceRecord[] {
    // When answering with a PTR, include the matching SRV/TXT/address records.
    const additionals: ResourceRecord[] = [];
    const wantInstance = answers.some((a) => a.type === ResourceType.PTR);
    if (wantInstance) {
      for (const rec of this.records) {
        if (
          rec.type === ResourceType.SRV || rec.type === ResourceType.TXT ||
          isA(rec) || isAAAA(rec)
        ) {
          if (!answers.includes(rec)) additionals.push(rec);
        }
      }
    }
    return additionals;
  }

  private losesTieBreak(theirRecords: ResourceRecord[]): boolean {
    const ours = [...this.uniqueRecords()].sort(recordSort);
    const theirs = [...theirRecords].filter((r) =>
      this.uniqueRecords().some((o) =>
        nameKey(o.name) === nameKey(r.name) && o.type === r.type
      )
    ).sort(recordSort);
    for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
      if (i >= ours.length) return true; // theirs is longer → we lose
      if (i >= theirs.length) return false;
      const cmp = recordSort(
        ours[i] as ResourceRecord,
        theirs[i] as ResourceRecord,
      );
      if (cmp !== 0) return cmp === -1;
    }
    return false;
  }

  private reprobe(): void {
    // Cancel current schedule and re-run the lifecycle under a fresh name.
    this.clearTimers();
    this.rename();
  }

  private resolvedReady(): boolean {
    // Ready has resolved once we've begun announcing.
    return this.announcing;
  }

  private announcing = false;

  // ── Goodbye / teardown ────────────────────────────────────────────────────────

  private buildGoodbyeMessage(): DnsMessage {
    return {
      header: responseHeader(),
      questions: [],
      answers: this.records.map((r) => ({ ...r, ttl: 0 })),
      authorities: [],
      additionals: [],
    };
  }

  /** Stop advertising, sending a goodbye packet (RFC 6762 §10.1). */
  stop(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.announcing) {
      this.ctx.send(this.buildGoodbyeMessage());
    }
    this.close();
    return Promise.resolve();
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.ctx.unregister(this);
  }

  /**
   * Cancel every scheduled timer and reset the response-aggregation state.
   * Shared by {@link close} and {@link reprobe} so a re-probe never leaves a
   * dead flush timer behind (which would silently disable all future answers).
   */
  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.flushTimer = null;
    this.pendingAnswers = [];
  }

  private schedule(delayMs: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.closed) fn();
    }, delayMs);
    this.timers.add(timer);
  }
}

function defaultHostLabel(hostname: string, domain: string): string {
  const sanitized = hostname.replace(/\.local$/i, "").replace(/[^\w-]/g, "-") ||
    "host";
  return `${sanitized}.${domain}`;
}

function queryHeader(): DnsMessage["header"] {
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

function responseHeader(): DnsMessage["header"] {
  return {
    id: 0,
    isResponse: true,
    opcode: 0,
    authoritative: true,
    truncated: false,
    recursionDesired: false,
    recursionAvailable: false,
    rcode: 0,
  };
}
