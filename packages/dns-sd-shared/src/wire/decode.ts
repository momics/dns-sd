/**
 * Decode DNS messages from wire format into {@link DnsMessage}, with strict
 * bounds checking throughout (see {@link Reader}). Malformed packets raise a
 * {@link WireError} instead of reading out of range.
 *
 * @module
 */

import { Reader, WireError } from "./reader.ts";
import {
  type DnsClass,
  type DnsHeader,
  type DnsMessage,
  type DnsQuestion,
  type Opcode,
  type Rcode,
  type ResourceRecord,
  ResourceType,
  type TxtAttributes,
} from "./types.ts";

const HEADER_LENGTH = 12;

/**
 * Minimum on-wire size of a question: a root name (1 byte) + QTYPE (2) +
 * QCLASS (2).
 */
const MIN_QUESTION_BYTES = 5;

/**
 * Minimum on-wire size of a resource record: a root name (1 byte) + TYPE (2) +
 * CLASS (2) + TTL (4) + RDLENGTH (2), with zero-length RDATA.
 */
const MIN_RECORD_BYTES = 11;

/**
 * Reject a section whose declared count could not possibly fit in the bytes that
 * remain — e.g. a u16 count of 65535 over a near-empty datagram. This bounds a
 * DoS-shaped claim (a huge count that would otherwise drive a long parse loop)
 * without imposing a flat ceiling that would wrongly reject a legitimately large
 * mDNS datagram: RFC 6762 permits messages up to ~9000 bytes, and a §7.1
 * known-answer suppression list can carry many hundreds of records. The
 * bounds-checked {@link Reader} still guards every individual read; this is an
 * early, explicit rejection of an impossible claim.
 */
function checkSectionFits(
  count: number,
  minBytes: number,
  remaining: number,
  section: string,
): void {
  if (count * minBytes > remaining) {
    throw new WireError(
      `${section} count ${count} cannot fit in ${remaining} remaining byte(s)`,
    );
  }
}

/** Decode a complete DNS message. Throws {@link WireError} if malformed. */
export function decodeMessage(bytes: Uint8Array): DnsMessage {
  if (bytes.byteLength < HEADER_LENGTH) {
    throw new WireError(
      `message too short: ${bytes.byteLength} bytes (need at least ${HEADER_LENGTH})`,
    );
  }

  const reader = new Reader(bytes);

  const id = reader.u16();
  const flags = reader.u16();
  const qdCount = reader.u16();
  const anCount = reader.u16();
  const nsCount = reader.u16();
  const arCount = reader.u16();

  const remaining = bytes.byteLength - HEADER_LENGTH;
  checkSectionFits(qdCount, MIN_QUESTION_BYTES, remaining, "question");
  checkSectionFits(anCount, MIN_RECORD_BYTES, remaining, "answer");
  checkSectionFits(nsCount, MIN_RECORD_BYTES, remaining, "authority");
  checkSectionFits(arCount, MIN_RECORD_BYTES, remaining, "additional");

  const header: DnsHeader = {
    id,
    isResponse: (flags & 0x8000) !== 0,
    opcode: ((flags >> 11) & 0x0f) as Opcode,
    authoritative: (flags & 0x0400) !== 0,
    truncated: (flags & 0x0200) !== 0,
    recursionDesired: (flags & 0x0100) !== 0,
    recursionAvailable: (flags & 0x0080) !== 0,
    rcode: (flags & 0x000f) as Rcode,
  };

  const questions: DnsQuestion[] = [];
  for (let i = 0; i < qdCount; i++) {
    questions.push(decodeQuestion(reader));
  }

  const answers = decodeRecords(reader, anCount);
  const authorities = decodeRecords(reader, nsCount);
  const additionals = decodeRecords(reader, arCount);

  return { header, questions, answers, authorities, additionals };
}

function decodeQuestion(reader: Reader): DnsQuestion {
  const name = reader.name();
  const type = reader.u16() as ResourceType;
  const rawClass = reader.u16();
  return {
    name,
    type,
    // The top bit of QCLASS is the mDNS unicast-response (QU) bit.
    class: (rawClass & 0x7fff) as DnsClass,
    unicastResponse: (rawClass & 0x8000) !== 0,
  };
}

function decodeRecords(reader: Reader, count: number): ResourceRecord[] {
  const records: ResourceRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push(decodeRecord(reader));
  }
  return records;
}

function decodeRecord(reader: Reader): ResourceRecord {
  const name = reader.name();
  const type = reader.u16() as ResourceType;
  const rawClass = reader.u16();
  const ttl = reader.u32();
  const rdLength = reader.u16();

  const rdataStart = reader.offset;
  const rdataEnd = rdataStart + rdLength;
  if (rdataEnd > reader.length) {
    throw new WireError(
      `RDATA of length ${rdLength} at offset ${rdataStart} extends past end of message`,
    );
  }

  const base = {
    name,
    class: (rawClass & 0x7fff) as DnsClass,
    ttl,
    // The top bit of the RR CLASS is the mDNS cache-flush bit.
    flush: (rawClass & 0x8000) !== 0,
  };

  let record: ResourceRecord;

  switch (type) {
    case ResourceType.A: {
      if (rdLength !== 4) {
        throw new WireError(`A record RDATA must be 4 bytes, got ${rdLength}`);
      }
      const address = [reader.u8(), reader.u8(), reader.u8(), reader.u8()];
      record = { ...base, type: ResourceType.A, data: { kind: "A", address } };
      break;
    }
    case ResourceType.AAAA: {
      if (rdLength !== 16) {
        throw new WireError(
          `AAAA record RDATA must be 16 bytes, got ${rdLength}`,
        );
      }
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) parts.push(reader.u16().toString(16));
      record = {
        ...base,
        type: ResourceType.AAAA,
        data: { kind: "AAAA", address: compressIpv6(parts) },
      };
      break;
    }
    case ResourceType.PTR: {
      record = {
        ...base,
        type: ResourceType.PTR,
        data: { kind: "PTR", name: reader.name() },
      };
      break;
    }
    case ResourceType.TXT: {
      record = {
        ...base,
        type: ResourceType.TXT,
        data: { kind: "TXT", attributes: decodeTxt(reader, rdataEnd) },
      };
      break;
    }
    case ResourceType.SRV: {
      const priority = reader.u16();
      const weight = reader.u16();
      const port = reader.u16();
      const target = reader.name();
      record = {
        ...base,
        type: ResourceType.SRV,
        data: { kind: "SRV", priority, weight, port, target },
      };
      break;
    }
    case ResourceType.NSEC: {
      const nextDomainName = reader.name();
      const types = decodeNsecBitmap(reader, rdataEnd);
      record = {
        ...base,
        type: ResourceType.NSEC,
        data: { kind: "NSEC", nextDomainName, types },
      };
      break;
    }
    default: {
      record = {
        ...base,
        type,
        data: { kind: "RAW", bytes: reader.take(rdLength) },
      };
      break;
    }
  }

  // Always resynchronise to the declared RDATA boundary. This tolerates
  // trailing bytes and prevents an embedded compression pointer from leaving
  // the cursor at an unexpected position.
  reader.offset = rdataEnd;
  return record;
}

/** Decode TXT RDATA — a series of length-prefixed key[=value] strings. */
function decodeTxt(reader: Reader, rdataEnd: number): TxtAttributes {
  const attributes: TxtAttributes = {};

  while (reader.offset < rdataEnd) {
    const len = reader.u8();
    if (len === 0) {
      // An empty string is allowed as padding; a lone zero-length TXT record
      // (RFC 6763 §6.1) yields no attributes.
      continue;
    }
    if (reader.offset + len > rdataEnd) {
      throw new WireError("TXT attribute extends past RDATA");
    }
    const raw = reader.take(len);

    // Split on the first '=' (0x3d).
    let eq = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 0x3d) {
        eq = i;
        break;
      }
    }

    if (eq === -1) {
      // No '=': attribute present with no value.
      attributes[utf8(raw)] = true;
    } else {
      const key = utf8(raw.subarray(0, eq));
      const value = raw.subarray(eq + 1);
      // `key=` (empty value) is represented as null; a non-empty value as bytes.
      attributes[key] = value.length === 0 ? null : value.slice();
    }
  }

  return attributes;
}

/** Decode the (restricted, single-window) NSEC type bitmap used by mDNS. */
function decodeNsecBitmap(reader: Reader, rdataEnd: number): number[] {
  const types: number[] = [];

  while (reader.offset < rdataEnd) {
    const windowBlock = reader.u8();
    const bitmapLength = reader.u8();
    if (bitmapLength < 1 || bitmapLength > 32) {
      throw new WireError(`invalid NSEC bitmap length ${bitmapLength}`);
    }
    if (reader.offset + bitmapLength > rdataEnd) {
      throw new WireError("NSEC bitmap extends past RDATA");
    }
    const bitmap = reader.take(bitmapLength);
    for (let i = 0; i < bitmap.length; i++) {
      const octet = bitmap[i] as number;
      if (octet === 0) continue;
      for (let bit = 0; bit < 8; bit++) {
        if (octet & (1 << (7 - bit))) {
          types.push(windowBlock * 256 + i * 8 + bit);
        }
      }
    }
  }

  return types;
}

function utf8(bytes: Uint8Array): string {
  return UTF8_DECODER.decode(bytes);
}

const UTF8_DECODER = new TextDecoder();

/** Collapse the longest run of zero groups in an IPv6 address to `::`. */
function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  // `::` must replace a run of at least two zero groups.
  if (bestLen < 2) return groups.join(":");

  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLen).join(":");
  return `${head}::${tail}`;
}
