/**
 * Engine-level unit tests exercised directly (record cache) plus focused
 * behaviours over the in-memory loopback transport.
 *
 * @module
 */

import { assert, assertEquals, test } from "../src/testing/harness.ts";
import {
  DnsClass,
  type ResourceRecord,
  ResourceType,
} from "../src/wire/index.ts";
import { RecordCache } from "../src/engine/cache.ts";
import { FAST_TIMING } from "../src/engine/constants.ts";
import type { CacheEvent } from "../src/engine/cache.ts";

function ptr(instance: string, ttl = 120): ResourceRecord {
  return {
    name: ["_http", "_tcp", "local"],
    type: ResourceType.PTR,
    class: DnsClass.IN,
    ttl,
    flush: false,
    data: { kind: "PTR", name: [instance, "_http", "_tcp", "local"] },
  };
}

function aRecord(addr: number[], ttl = 120, flush = true): ResourceRecord {
  return {
    name: ["host", "local"],
    type: ResourceType.A,
    class: DnsClass.IN,
    ttl,
    flush,
    data: { kind: "A", address: addr },
  };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("cache: adding a new record emits 'added'", () => {
  const events: CacheEvent[] = [];
  const cache = new RecordCache({
    timing: FAST_TIMING,
    onRequery: () => {},
    emit: (e) => events.push(e),
  });
  cache.add(ptr("A"));
  assertEquals(events.length, 1);
  assertEquals(events[0]!.kind, "added");
  cache.close();
});

test("cache: refreshing the same record does not re-emit", () => {
  const events: CacheEvent[] = [];
  const cache = new RecordCache({
    timing: FAST_TIMING,
    onRequery: () => {},
    emit: (e) => events.push(e),
  });
  cache.add(ptr("A"));
  cache.add(ptr("A"));
  assertEquals(events.filter((e) => e.kind === "added").length, 1);
  cache.close();
});

test("cache: TTL=0 goodbye removes the record after the grace period", async () => {
  const events: CacheEvent[] = [];
  const cache = new RecordCache({
    timing: FAST_TIMING,
    onRequery: () => {},
    emit: (e) => events.push(e),
  });
  cache.add(ptr("A"));
  cache.add(ptr("A", 0)); // goodbye
  await delay(FAST_TIMING.goodbyeGraceMs + 30);
  assert(
    events.some((e) => e.kind === "removed"),
    "expected a removed event after goodbye grace",
  );
  cache.close();
});

test("cache: cache-flush supersedes a conflicting unique record", () => {
  const events: CacheEvent[] = [];
  const cache = new RecordCache({
    timing: FAST_TIMING,
    onRequery: () => {},
    emit: (e) => events.push(e),
  });
  cache.add(aRecord([1, 1, 1, 1]));
  cache.add(aRecord([2, 2, 2, 2])); // flush=true, different RDATA
  const removed = events.filter((e) => e.kind === "removed");
  assertEquals(removed.length, 1, "old address should be flushed");
  const remaining = cache.records();
  assertEquals(remaining.length, 1);
  cache.close();
});

test("cache: record expires after its TTL", async () => {
  const events: CacheEvent[] = [];
  const cache = new RecordCache({
    timing: FAST_TIMING,
    onRequery: () => {},
    emit: (e) => events.push(e),
  });
  // 0-second TTL isn't a goodbye path here; use a tiny fractional TTL.
  cache.add({ ...ptr("A"), ttl: 0.05 });
  await delay(120);
  assert(
    events.some((e) => e.kind === "removed"),
    "expected removal after TTL elapsed",
  );
  cache.close();
});
