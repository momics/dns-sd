/**
 * A resource-record cache with TTL expiry, cache-flush handling and TTL=0
 * "goodbye" processing (RFC 6762 §10). Emits cache events consumed by the
 * browse state machine.
 *
 * @module
 */

import type { ResourceRecord } from "../wire/types.ts";
import type { EngineTiming } from "./constants.ts";
import { compareRdata, recordKey, recordNameTypeKey } from "./records.ts";

/** A cache change event. */
export interface CacheEvent {
  kind: "added" | "updated" | "removed";
  record: ResourceRecord;
}

interface CacheEntry {
  record: ResourceRecord;
  timers: ReturnType<typeof setTimeout>[];
}

/**
 * Caches resource records keyed by (name, type, RDATA), scheduling expiry and
 * periodic re-queries. A single {@link RecordCache} is shared by a browse
 * operation across all the record types it tracks.
 */
export class RecordCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly timing: EngineTiming;
  private readonly onRequery: (record: ResourceRecord) => void;
  private readonly emit: (event: CacheEvent) => void;
  private closed = false;

  constructor(opts: {
    timing: EngineTiming;
    onRequery: (record: ResourceRecord) => void;
    emit: (event: CacheEvent) => void;
  }) {
    this.timing = opts.timing;
    this.onRequery = opts.onRequery;
    this.emit = opts.emit;
  }

  /** All currently cached records. */
  records(): ResourceRecord[] {
    return Array.from(this.entries.values(), (e) => e.record);
  }

  /** Cached records answering a (name, type) question, for known-answer suppression. */
  knownAnswers(nameTypeKey: string): ResourceRecord[] {
    const out: ResourceRecord[] = [];
    for (const entry of this.entries.values()) {
      if (recordNameTypeKey(entry.record) === nameTypeKey) {
        out.push(entry.record);
      }
    }
    return out;
  }

  /** Add or refresh a record received from the network. */
  add(record: ResourceRecord): void {
    if (this.closed) return;

    // TTL=0 is a goodbye: schedule prompt removal (RFC 6762 §10.1).
    if (record.ttl === 0) {
      this.scheduleGoodbye(record);
      return;
    }

    // Cache-flush: this unique record supersedes others of the same name/type
    // whose RDATA differs (RFC 6762 §10.2).
    if (record.flush) {
      this.flushSiblings(record);
    }

    const key = recordKey(record);
    const existing = this.entries.get(key);
    if (existing) {
      // Same record refreshed — reset its timers, keep it, no event churn.
      this.clearTimers(existing);
      existing.record = record;
      existing.timers = this.scheduleLifetime(record);
      return;
    }

    const entry: CacheEntry = {
      record,
      timers: this.scheduleLifetime(record),
    };
    this.entries.set(key, entry);
    this.emit({ kind: "added", record });
  }

  private flushSiblings(record: ResourceRecord): void {
    const group = recordNameTypeKey(record);
    for (const [key, entry] of this.entries) {
      if (
        recordNameTypeKey(entry.record) === group &&
        compareRdata(entry.record, record) !== 0
      ) {
        this.clearTimers(entry);
        this.entries.delete(key);
        this.emit({ kind: "removed", record: entry.record });
      }
    }
  }

  private scheduleGoodbye(record: ResourceRecord): void {
    const key = recordKey(record);
    const existing = this.entries.get(key);
    if (!existing) return;
    this.clearTimers(existing);
    existing.timers = [
      setTimeout(() => this.expire(key), this.timing.goodbyeGraceMs),
    ];
  }

  private scheduleLifetime(
    record: ResourceRecord,
  ): ReturnType<typeof setTimeout>[] {
    const key = recordKey(record);
    const lifetimeMs = record.ttl * 1000;
    const timers = [setTimeout(() => this.expire(key), lifetimeMs)];
    // Re-query at ~80/85/90/95% of the lifetime (RFC 6762 §5.2).
    for (const pct of [80, 85, 90, 95]) {
      const jitter = pct + Math.random() * 2;
      timers.push(
        setTimeout(() => {
          if (this.entries.has(key)) this.onRequery(record);
        }, (jitter / 100) * lifetimeMs),
      );
    }
    return timers;
  }

  private expire(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.clearTimers(entry);
    this.entries.delete(key);
    this.emit({ kind: "removed", record: entry.record });
  }

  private clearTimers(entry: CacheEntry): void {
    for (const timer of entry.timers) clearTimeout(timer);
    entry.timers = [];
  }

  /** Remove all records and stop all timers. */
  close(): void {
    this.closed = true;
    for (const entry of this.entries.values()) this.clearTimers(entry);
    this.entries.clear();
  }
}
