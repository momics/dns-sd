/**
 * Property-based codec tests.
 *
 * These complement the hand-written vectors in {@link ./codec.test.ts} by
 * exercising the wire codec across thousands of generated inputs. Two families
 * of properties are checked:
 *
 *   1. **Round-trip stability** — for randomly generated *valid* messages, the
 *      byte encoding survives a decode/re-encode cycle unchanged. This is the
 *      strong invariant that transitively covers name compression, TXT ordering
 *      and address canonicalisation without having to model each of them.
 *
 *   2. **Hostile-input robustness** — for arbitrary and structured-but-garbage
 *      byte inputs, {@link decodeMessage} only ever throws {@link WireError}
 *      (never an unexpected crash) and always terminates quickly (guarding
 *      against pointer-loop / decompression-bomb style hangs).
 *
 * Generation is driven by a small seeded PRNG so failures are reproducible: the
 * seed and the offending input are included in every failure message.
 *
 * @module
 */

import { assert, test } from "../src/testing/harness.ts";
import {
  decodeMessage,
  DnsClass,
  type DnsMessage,
  encodeMessage,
  type ResourceRecord,
  ResourceType,
  WireError,
} from "../src/wire/index.ts";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

/** A tiny deterministic PRNG with convenience helpers for generators. */
class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    let t = (this.#state = (this.#state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(): boolean {
    return this.next() < 0.5;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.int(0, 255);
    return out;
  }
}

// ── Generators for VALID messages ─────────────────────────────────────────────

const LABEL_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
// TXT keys must not contain "=" (the key/value separator) and must be non-empty.
const TXT_KEY_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789-_";
// RAW records use TYPE values the decoder does not interpret structurally.
const KNOWN_TYPES = new Set<number>([1, 12, 16, 28, 33, 47, 255]);

function genLabel(rng: Rng): string {
  const len = rng.int(1, 12);
  let label = "";
  for (let i = 0; i < len; i++) label += rng.pick([...LABEL_CHARS]);
  return label;
}

function genName(rng: Rng): string[] {
  const labels = rng.int(1, 4);
  const name: string[] = [];
  for (let i = 0; i < labels; i++) name.push(genLabel(rng));
  return name;
}

function genHeader(rng: Rng): DnsMessage["header"] {
  return {
    id: rng.int(0, 0xffff),
    isResponse: rng.bool(),
    opcode: rng.int(0, 15),
    authoritative: rng.bool(),
    truncated: rng.bool(),
    recursionDesired: rng.bool(),
    recursionAvailable: rng.bool(),
    rcode: rng.int(0, 15),
  };
}

function genQuestion(rng: Rng): DnsMessage["questions"][number] {
  return {
    name: genName(rng),
    type: rng.pick([
      ResourceType.A,
      ResourceType.PTR,
      ResourceType.TXT,
      ResourceType.AAAA,
      ResourceType.SRV,
      ResourceType.ANY,
    ]),
    // Only the low 15 bits survive encoding; the top bit is the QU flag, which
    // is generated separately so round-trips stay byte-stable.
    class: rng.pick([DnsClass.IN, DnsClass.ANY]),
    unicastResponse: rng.bool(),
  };
}

function genIpv6(rng: Rng): string {
  // Emit a fully-expanded 8-group address so encodeIpv6() always accepts it;
  // byte-stability does not depend on the string form the decoder chooses.
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push(rng.int(0, 0xffff).toString(16).padStart(4, "0"));
  }
  return groups.join(":");
}

function genTxtAttributes(rng: Rng): Record<string, Uint8Array | true | null> {
  const attrs: Record<string, Uint8Array | true | null> = {};
  const count = rng.int(0, 4);
  for (let i = 0; i < count; i++) {
    const keyLen = rng.int(1, 8);
    let key = "";
    for (let j = 0; j < keyLen; j++) key += rng.pick([...TXT_KEY_CHARS]);
    const variant = rng.int(0, 2);
    if (variant === 0) attrs[key] = true;
    else if (variant === 1) attrs[key] = null;
    else attrs[key] = rng.bytes(rng.int(0, 16));
  }
  return attrs;
}

function genRecord(rng: Rng): ResourceRecord {
  const name = genName(rng);
  const cls = rng.pick([DnsClass.IN, DnsClass.CH]);
  const ttl = rng.int(0, 0xffffffff);
  const flush = rng.bool();
  const base = { name, class: cls, ttl, flush } as const;
  const kind = rng.int(0, 6);
  switch (kind) {
    case 0:
      return {
        ...base,
        type: ResourceType.A,
        data: { kind: "A", address: [...rng.bytes(4)] },
      };
    case 1:
      return {
        ...base,
        type: ResourceType.AAAA,
        data: { kind: "AAAA", address: genIpv6(rng) },
      };
    case 2:
      return {
        ...base,
        type: ResourceType.PTR,
        data: { kind: "PTR", name: genName(rng) },
      };
    case 3:
      return {
        ...base,
        type: ResourceType.TXT,
        data: { kind: "TXT", attributes: genTxtAttributes(rng) },
      };
    case 4:
      return {
        ...base,
        type: ResourceType.SRV,
        data: {
          kind: "SRV",
          priority: rng.int(0, 0xffff),
          weight: rng.int(0, 0xffff),
          port: rng.int(0, 0xffff),
          target: genName(rng),
        },
      };
    case 5: {
      // NSEC bitmap only encodes window-0 types (0-255). At least one type is
      // required: an empty NSEC is a degenerate record (an NSEC exists to
      // assert which types are present) and does not round-trip.
      const types: number[] = [];
      const n = rng.int(1, 6);
      for (let i = 0; i < n; i++) types.push(rng.int(0, 255));
      return {
        ...base,
        type: ResourceType.NSEC,
        data: { kind: "NSEC", nextDomainName: genName(rng), types },
      };
    }
    default: {
      // A RAW record with a TYPE the decoder leaves uninterpreted.
      let type = rng.int(1, 0xffff);
      while (KNOWN_TYPES.has(type)) type = rng.int(1, 0xffff);
      return {
        ...(base as ResourceRecord & { type: number }),
        type,
        data: { kind: "RAW", bytes: rng.bytes(rng.int(0, 20)) },
      } as ResourceRecord;
    }
  }
}

function genRecords(rng: Rng): ResourceRecord[] {
  const count = rng.int(0, 3);
  const records: ResourceRecord[] = [];
  for (let i = 0; i < count; i++) records.push(genRecord(rng));
  return records;
}

function genMessage(rng: Rng): DnsMessage {
  const questionCount = rng.int(0, 3);
  const questions: DnsMessage["questions"] = [];
  for (let i = 0; i < questionCount; i++) questions.push(genQuestion(rng));
  return {
    header: genHeader(rng),
    questions,
    answers: genRecords(rng),
    authorities: genRecords(rng),
    additionals: genRecords(rng),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * A fixed base seed keeps this gating suite fully deterministic (no CI flakes).
 * Every generated case is reproducible from `BASE_SEED + i`; failure messages
 * print the exact seed so a case can be replayed in isolation.
 */
const BASE_SEED = 0x1a2b3c4d;

// ── Properties ────────────────────────────────────────────────────────────────

test("property: valid messages survive a decode/re-encode round-trip byte-stably", () => {
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    const seed = (BASE_SEED + i) >>> 0;
    const rng = new Rng(seed);
    const message = genMessage(rng);

    let encoded: Uint8Array;
    try {
      encoded = encodeMessage(message);
    } catch (err) {
      throw new Error(
        `generator produced an unencodable message (seed=${seed}): ${
          String(err)
        }`,
      );
    }

    let reencoded: Uint8Array;
    try {
      reencoded = encodeMessage(decodeMessage(encoded));
    } catch (err) {
      throw new Error(
        `decode/re-encode threw for a valid message (seed=${seed}, bytes=${
          hex(encoded)
        }): ${String(err)}`,
      );
    }

    assert(
      bytesEqual(encoded, reencoded),
      `round-trip was not byte-stable (seed=${seed})\n` +
        `  original:  ${hex(encoded)}\n` +
        `  re-encoded: ${hex(reencoded)}`,
    );
  }
});

test("property: decoding is deterministic", () => {
  for (let i = 0; i < 200; i++) {
    const seed = (BASE_SEED ^ (0xa5a5a5a5 + i)) >>> 0;
    const rng = new Rng(seed);
    const encoded = encodeMessage(genMessage(rng));
    const first = encodeMessage(decodeMessage(encoded));
    const second = encodeMessage(decodeMessage(encoded));
    assert(
      bytesEqual(first, second),
      `decode was not deterministic (seed=${seed})`,
    );
  }
});

test("property: arbitrary bytes only ever throw WireError and never hang", () => {
  const iterations = 3000;
  const perInputBudgetMs = 250;
  for (let i = 0; i < iterations; i++) {
    const seed = (BASE_SEED ^ (0x5f5f5f5f + i * 2654435761)) >>> 0;
    const rng = new Rng(seed);
    const len = rng.int(0, 1024);
    const bytes = rng.bytes(len);

    const start = Date.now();
    try {
      decodeMessage(bytes);
    } catch (err) {
      if (!(err instanceof WireError)) {
        throw new Error(
          `decode threw a non-WireError (seed=${seed}, bytes=${hex(bytes)}): ${
            String(err)
          }`,
        );
      }
    }
    const elapsed = Date.now() - start;
    assert(
      elapsed < perInputBudgetMs,
      `decode took ${elapsed}ms (budget ${perInputBudgetMs}ms) — possible hang ` +
        `(seed=${seed}, len=${len})`,
    );
  }
});

test("property: valid header + hostile body is handled safely", () => {
  // A well-formed 12-byte header (claiming records) followed by adversarial
  // bytes reaches deeper into the parser than fully-random input usually does.
  const iterations = 2000;
  for (let i = 0; i < iterations; i++) {
    const seed = (BASE_SEED ^ (0x12345678 + i * 40503)) >>> 0;
    const rng = new Rng(seed);
    const tail = rng.bytes(rng.int(0, 256));
    const bytes = new Uint8Array(12 + tail.length);
    // QDCOUNT / ANCOUNT / NSCOUNT / ARCOUNT small but non-zero, so the decoder
    // attempts to parse the hostile tail as records.
    bytes[2] = 0x84; // response, authoritative
    bytes[5] = rng.int(0, 3); // QDCOUNT
    bytes[7] = rng.int(0, 3); // ANCOUNT
    bytes[9] = rng.int(0, 2); // NSCOUNT
    bytes[11] = rng.int(0, 2); // ARCOUNT
    bytes.set(tail, 12);

    try {
      decodeMessage(bytes);
    } catch (err) {
      if (!(err instanceof WireError)) {
        throw new Error(
          `decode threw a non-WireError (seed=${seed}, bytes=${hex(bytes)}): ${
            String(err)
          }`,
        );
      }
    }
  }
});
