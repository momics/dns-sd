/**
 * Golden wire vectors — byte-exact DNS-SD / mDNS packets, pinned so the wire
 * codec cannot silently drift from the real ecosystem (`testing-strategy.md` §2).
 *
 * Provenance is recorded per vector in {@link GoldenVector.source}:
 *
 * - `captured:` — raw bytes observed on the wire from Apple Bonjour
 *   (`mDNSResponder`). Where a capture carried personally-identifying leaf
 *   values (instance/host names, MAC, IP addresses) they were replaced with
 *   **same-length** neutral placeholders, so every header flag, TTL,
 *   cache-flush bit, name-compression pointer, RDLENGTH and record ordering is
 *   preserved *exactly* as emitted — only opaque leaf octets differ.
 * - `spec-derived:` — bytes constructed from the RFCs (1035 / 6762 / 6763) for
 *   a shape a live capture did not provide here, produced by this codec's own
 *   canonical encoder and cited to its clause. Clearly *not* live-captured.
 *
 * Real Avahi captures are intentionally absent: Avahi is Linux-only and was not
 * available in the capture environment. A human on Linux can add
 * `captured:avahi` vectors later using this same structure.
 *
 * @module
 */

import {
  DnsClass,
  type DnsMessage,
  ResourceType,
} from "../../src/wire/index.ts";

/** Decode a lowercase hex string into bytes (test-only helper). */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** UTF-8 encode a TXT attribute value (test-only helper). */
function txt(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** A single golden wire vector: raw bytes plus the structure they must decode to. */
export interface GoldenVector {
  /** Stable identifier used in the test name. */
  readonly name: string;
  /** What real-world behaviour this vector pins. */
  readonly description: string;
  /** Provenance (see module docs): `captured:…` or `spec-derived:…`. */
  readonly source: string;
  /** The governing RFC clause(s). */
  readonly rfc: string;
  /** The packet, as a lowercase hex string. */
  readonly hex: string;
  /**
   * Whether the test asserts that re-encoding reproduces {@link hex}
   * byte-for-byte, in addition to decoding + semantic round-trip.
   *
   * `true` when this codec's canonical output *is* these exact bytes — always
   * for `spec-derived` vectors (canonical by construction), and for a
   * `captured` vector when our encoder is verified to reproduce it exactly
   * (the real Bonjour announcement here: 230→230 bytes identical). Pinning
   * exact bytes there is deliberate: in this frozen-wire library it also
   * catches encode-side compression/ordering regressions, and a *deliberate*
   * future encoder change should trip this vector as a "wire behaviour changed
   * — come look / re-baseline" signal, exactly like the API snapshot.
   *
   * `false` pins *meaning* only (decode + semantic round-trip), used where a
   * foreign stack's equally-valid-but-different layout should not be asserted
   * as bytes. The captured browse query is kept `false` on purpose, so both
   * modes stay exercised and documented by example.
   */
  readonly byteStable: boolean;
  /** The exact structure {@link hex} must decode to. */
  readonly expect: DnsMessage;
}

const service = ["_http", "_tcp", "local"];
const instance = ["Example Web Device Configuration", "_http", "_tcp", "local"];
const host = ["webdev01", "local"];

/**
 * The full set of golden wire vectors, exercised by `test/golden-wire.test.ts`
 * under both Deno and Node.
 */
export const goldenVectors: readonly GoldenVector[] = [
  {
    name: "bonjour browse query (QM PTR)",
    description:
      "A DNS-SD service-browse: a multicast (QM) PTR question for a service " +
      "type, with QDCOUNT=1 and all-zero flags.",
    source:
      "captured: Apple Bonjour (mDNSResponder 2881.120.11, macOS 26.5.1) — " +
      "own `dns-sd -B _goldentest._tcp` query, 2026-07-08 (own traffic; " +
      "invented service type, no anonymisation needed)",
    rfc: "RFC 6763 §4.1 (browse) / RFC 1035 §4.1.2 (question)",
    hex:
      "0000000000010000000000000b5f676f6c64656e74657374045f746370056c6f63616c00000c0001",
    // captured: kept semantic-only on purpose (byteStable=false) so both
    // assertion modes stay exercised and documented (see `byteStable` docs).
    byteStable: false,
    expect: {
      header: {
        id: 0,
        isResponse: false,
        opcode: 0,
        authoritative: false,
        truncated: false,
        recursionDesired: false,
        recursionAvailable: false,
        rcode: 0,
      },
      questions: [
        {
          name: ["_goldentest", "_tcp", "local"],
          type: ResourceType.PTR,
          class: DnsClass.IN,
          unicastResponse: false,
        },
      ],
      answers: [],
      authorities: [],
      additionals: [],
    },
  },
  {
    name: "bonjour announcement (PTR/TXT/SRV/A/AAAA/NSEC)",
    description:
      "An authoritative announcement (QR=1, AA=1) for one service instance: a " +
      "shared PTR answer plus the instance's TXT/SRV, host A/AAAA, and two " +
      "NSEC records, all in the additional section, using name compression. " +
      "The cache-flush bit is set on the unique records but not the shared PTR.",
    source:
      "captured: Apple Bonjour (mDNSResponder) `_http._tcp` announcement on " +
      "the local network, 2026-07-08. Personally-identifying leaves " +
      "(instance name, host label, TXT MAC value, IPv4, IPv6) replaced with " +
      "same-length placeholders — all framing, compression pointers, TTLs, " +
      "flags and record order preserved byte-for-byte as emitted.",
    rfc: "RFC 6763 §4.1/§6, RFC 6762 §6.1 (NSEC)/§10.2 (cache-flush)",
    hex:
      "000084000000000100000006055f68747470045f746370056c6f63616c00000c0001000011940023204578616d706c65205765622044657669636520436f6e66696775726174696f6ec00cc0280010800100001194001d06706174683d2f154d41433d30303a30303a35453a30303a35333a3031c02800218001000000780011000000000dfe087765626465763031c017c08600018001000000780004c0000281c086001c8001000000780010fe800000000000000000000000000001c028002f8001000011940009c02800050000800040c086002f8001000000780008c086000440000008",
    // captured: our encoder is canonical for THIS packet (230→230 bytes
    // identical), so we pin exact bytes — this also guards encode-side
    // compression/ordering, and a deliberate future encoder change should
    // re-baseline this vector on purpose ("wire behaviour changed — come look").
    byteStable: true,
    expect: {
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
      answers: [
        {
          name: service,
          type: ResourceType.PTR,
          class: DnsClass.IN,
          ttl: 4500,
          flush: false,
          data: { kind: "PTR", name: instance },
        },
      ],
      authorities: [],
      additionals: [
        {
          name: instance,
          type: ResourceType.TXT,
          class: DnsClass.IN,
          ttl: 4500,
          flush: true,
          data: {
            kind: "TXT",
            attributes: {
              path: txt("/"),
              MAC: txt("00:00:5E:00:53:01"),
            },
          },
        },
        {
          name: instance,
          type: ResourceType.SRV,
          class: DnsClass.IN,
          ttl: 120,
          flush: true,
          data: {
            kind: "SRV",
            priority: 0,
            weight: 0,
            port: 3582,
            target: host,
          },
        },
        {
          name: host,
          type: ResourceType.A,
          class: DnsClass.IN,
          ttl: 120,
          flush: true,
          data: { kind: "A", address: [192, 0, 2, 129] },
        },
        {
          name: host,
          type: ResourceType.AAAA,
          class: DnsClass.IN,
          ttl: 120,
          flush: true,
          data: { kind: "AAAA", address: "fe80::1" },
        },
        {
          name: instance,
          type: ResourceType.NSEC,
          class: DnsClass.IN,
          ttl: 4500,
          flush: true,
          data: {
            kind: "NSEC",
            nextDomainName: instance,
            types: [ResourceType.TXT, ResourceType.SRV],
          },
        },
        {
          name: host,
          type: ResourceType.NSEC,
          class: DnsClass.IN,
          ttl: 120,
          flush: true,
          data: {
            kind: "NSEC",
            nextDomainName: host,
            types: [ResourceType.A, ResourceType.AAAA],
          },
        },
      ],
    },
  },
  {
    name: "goodbye (PTR TTL=0)",
    description:
      "A goodbye: the shared PTR record re-sent with TTL=0 to withdraw the " +
      "service instance from every listener's cache.",
    source:
      "spec-derived: RFC 6762 §10.1 goodbye for the announcement above, " +
      "encoded canonically by this codec (no live goodbye was captured; " +
      "Bonjour emits exactly this on graceful deregistration)",
    rfc: "RFC 6762 §10.1 (goodbye packets, TTL=0)",
    hex:
      "000084000000000100000000055f68747470045f746370056c6f63616c00000c0001000000000023204578616d706c65205765622044657669636520436f6e66696775726174696f6ec00c",
    byteStable: true,
    expect: {
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
      answers: [
        {
          name: service,
          type: ResourceType.PTR,
          class: DnsClass.IN,
          ttl: 0,
          flush: false,
          data: { kind: "PTR", name: instance },
        },
      ],
      authorities: [],
      additionals: [],
    },
  },
];
