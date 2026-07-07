/**
 * Engine-level unit tests exercised directly (record cache) plus focused
 * behaviours over the in-memory loopback transport.
 *
 * @module
 */

import { assert, assertEquals, test } from "../src/testing/harness.ts";
import {
  DnsClass,
  type DnsMessage,
  type ResourceRecord,
  ResourceType,
} from "../src/wire/index.ts";
import { RecordCache } from "../src/engine/cache.ts";
import { FAST_TIMING } from "../src/engine/constants.ts";
import type { CacheEvent } from "../src/engine/cache.ts";
import {
  canonicalRdata,
  compareRdata,
  recordKey,
} from "../src/engine/records.ts";
import {
  type BrowseContext,
  Browser,
  MAX_INSTANCES,
} from "../src/engine/query.ts";
import type { ServiceAnnouncement } from "../src/types.ts";

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

test("records: canonical RDATA uses UTF-8 for non-ASCII names and TXT keys", () => {
  // A PTR whose target label contains 'é' (U+00E9). The canonical RDATA must
  // match the UTF-8 wire form (0x63 0x61 0x66 0xC3 0xA9), not Latin-1 (0xE9).
  const rr: ResourceRecord = {
    name: ["_http", "_tcp", "local"],
    type: ResourceType.PTR,
    class: DnsClass.IN,
    ttl: 120,
    flush: false,
    data: { kind: "PTR", name: ["café"] },
  };
  const rdata = canonicalRdata(rr);
  const label = new TextEncoder().encode("café");
  const expected = new Uint8Array([label.byteLength, ...label, 0]);
  assertEquals(
    [...rdata].join(","),
    [...expected].join(","),
    "PTR canonical name must be UTF-8, matching the wire encoder",
  );

  // A non-ASCII TXT key (U+0100, 'Ā') must be encoded as UTF-8 (0xC4 0x80),
  // never truncated to a single byte (0x00) — which would corrupt recordKey.
  const txt: ResourceRecord = {
    name: ["inst", "_http", "_tcp", "local"],
    type: ResourceType.TXT,
    class: DnsClass.IN,
    ttl: 120,
    flush: true,
    data: { kind: "TXT", attributes: { "Ā": true } },
  };
  const txtRdata = canonicalRdata(txt);
  const key = new TextEncoder().encode("Ā");
  assertEquals(
    [...txtRdata].join(","),
    [key.byteLength, ...key].join(","),
    "TXT key canonical bytes must be UTF-8",
  );
  // recordKey must reflect the UTF-8 TXT key bytes, not a truncated NUL.
  assert(
    recordKey(txt).endsWith("|02c480"),
    "recordKey must reflect UTF-8 TXT key bytes (0xC4 0x80), not a truncated NUL",
  );
});

test("records: RFC 6762 §8.2.1 tie-break orders non-ASCII names by UTF-8", () => {
  // U+00A0 encodes to C2 A0, U+0100 to C4 80. In UTF-8, C2 < C4 so the U+00A0
  // record sorts first. Under the old Latin-1 path U+00A0→A0 and U+0100→00,
  // which reverses the order (and both truncate to one byte), so two hosts
  // would disagree on the probe tie-break.
  const mk = (label: string): ResourceRecord => ({
    name: ["_http", "_tcp", "local"],
    type: ResourceType.PTR,
    class: DnsClass.IN,
    ttl: 120,
    flush: false,
    data: { kind: "PTR", name: [label] },
  });
  const lower = mk("\u00A0"); // C2 A0
  const higher = mk("\u0100"); // C4 80
  assertEquals(
    compareRdata(lower, higher),
    -1,
    "U+00A0 must sort before U+0100",
  );
  assertEquals(compareRdata(higher, lower), 1);
});

// ── Browser cache caps (issue #21) ────────────────────────────────────────────

test("cache: a record flood cannot grow entries past the cap (issue #21)", () => {
  // A PTR flood feeds many distinct (individually legal) records into the cache.
  // Each distinct RDATA is a distinct entry scheduling several timers, so an
  // uncapped cache would grow without bound. With the cap, entries level off.
  const cache = new RecordCache({
    timing: FAST_TIMING,
    onRequery: () => {},
    emit: () => {},
    maxEntries: 4,
  });
  for (let i = 0; i < 64; i++) cache.add(ptr(`inst-${i}`));
  assertEquals(
    cache.records().length,
    4,
    "cache must stop accepting new entries once the cap is reached",
  );
  // A record already in the cache still refreshes while the cache is full.
  cache.add(ptr("inst-0"));
  assertEquals(cache.records().length, 4);
  cache.close();
});

test("cache: expiry frees a slot so a new entry is admitted after the cap", async () => {
  const cache = new RecordCache({
    timing: FAST_TIMING,
    onRequery: () => {},
    emit: () => {},
    maxEntries: 2,
  });
  cache.add({ ...ptr("a"), ttl: 0.05 });
  cache.add({ ...ptr("b"), ttl: 0.05 });
  cache.add(ptr("c")); // refused: cache is full
  assertEquals(cache.records().length, 2);
  await delay(120); // a and b expire, freeing both slots
  assertEquals(cache.records().length, 0);
  cache.add(ptr("d")); // now admitted
  assertEquals(cache.records().length, 1);
  cache.close();
});

function silentContext(): BrowseContext {
  return {
    timing: FAST_TIMING,
    send: () => {},
    register: () => {},
    unregister: () => {},
  };
}

function ptrResponse(instance: string): DnsMessage {
  return {
    header: {
      id: 0,
      isResponse: true,
      opcode: 0,
      authoritative: true,
      truncated: false,
      recursionDesired: false,
      recursionAvailable: false,
      rcode: 0,
    },
    questions: [],
    answers: [{
      name: ["_http", "_tcp", "local"],
      type: ResourceType.PTR,
      class: DnsClass.IN,
      ttl: 120,
      flush: false,
      data: { kind: "PTR", name: [instance, "_http", "_tcp", "local"] },
    }],
    authorities: [],
    additionals: [],
  };
}

test("engine: a PTR flood cannot grow the instances map past MAX_INSTANCES", async () => {
  const browser = new Browser(silentContext(), {
    type: "http",
    protocol: "tcp",
    domain: "local",
  });

  const found: ServiceAnnouncement[] = [];
  const collecting = (async () => {
    for await (const ev of browser.events()) {
      if (ev.kind === "found") found.push(ev);
    }
  })();

  // Push distinctly-named instances well past the cap. Each distinct PTR would,
  // uncapped, create a new instance entry (and emit a "found" event).
  const flood = MAX_INSTANCES + 128;
  for (let i = 0; i < flood; i++) {
    browser.onResponse(ptrResponse(`inst-${i}`));
  }

  // Let the async drain observe every buffered event, then stop the stream.
  await new Promise<void>((r) => setTimeout(r, 0));
  browser.close();
  await collecting;

  assertEquals(
    found.length,
    MAX_INSTANCES,
    "the browser must stop accepting new instances at the cap",
  );
});
