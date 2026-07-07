/**
 * Encode {@link DnsMessage} values into DNS wire format.
 *
 * Domain-name compression (RFC 1035 §4.1.4) is applied using an exact-suffix
 * table, so re-encoded messages are compact and round-trip losslessly. The
 * encoder never sets the TC (truncation) bit.
 *
 * @module
 */

import {
  DnsClass,
  type DnsMessage,
  type DnsQuestion,
  isA,
  isAAAA,
  isNSEC,
  isPTR,
  isSRV,
  isTXT,
  type ResourceRecord,
  ResourceType,
  type TxtAttributes,
} from "./types.ts";

/** Highest offset that a compression pointer's 14-bit field can address. */
const MAX_POINTER_OFFSET = 0x3fff;

/** A growable big-endian byte writer with DNS name compression. */
class Writer {
  private buf: Uint8Array;
  private len = 0;
  /** Map of `labels.join('\x00')` suffix → absolute byte offset. */
  private readonly names = new Map<string, number>();

  constructor(initial = 512) {
    this.buf = new Uint8Array(initial);
  }

  private ensure(extra: number): void {
    const needed = this.len + extra;
    if (needed <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < needed) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  get offset(): number {
    return this.len;
  }

  u8(value: number): void {
    this.ensure(1);
    this.buf[this.len++] = value & 0xff;
  }

  u16(value: number): void {
    this.ensure(2);
    this.buf[this.len++] = (value >> 8) & 0xff;
    this.buf[this.len++] = value & 0xff;
  }

  u32(value: number): void {
    this.ensure(4);
    this.buf[this.len++] = (value >>> 24) & 0xff;
    this.buf[this.len++] = (value >>> 16) & 0xff;
    this.buf[this.len++] = (value >>> 8) & 0xff;
    this.buf[this.len++] = value & 0xff;
  }

  bytes(data: Uint8Array): void {
    this.ensure(data.byteLength);
    this.buf.set(data, this.len);
    this.len += data.byteLength;
  }

  /** Reserve a 16-bit length placeholder; returns a setter for the final value. */
  reserveU16(): (value: number) => void {
    const at = this.len;
    this.u16(0);
    return (value: number) => {
      this.buf[at] = (value >> 8) & 0xff;
      this.buf[at + 1] = value & 0xff;
    };
  }

  /** Write a domain name, compressing against previously written suffixes. */
  name(labels: string[]): void {
    for (let i = 0; i < labels.length; i++) {
      const suffix = labels.slice(i);
      const key = suffix.join("\x00");
      const pointer = this.names.get(key);
      if (pointer !== undefined) {
        this.u16(0xc000 | pointer);
        return;
      }
      if (this.len <= MAX_POINTER_OFFSET) {
        this.names.set(key, this.len);
      }
      const label = labels[i] as string;
      const bytes = latin1Bytes(label);
      if (bytes.byteLength > 63) {
        throw new RangeError(`label "${label}" exceeds 63 bytes`);
      }
      this.u8(bytes.byteLength);
      this.bytes(bytes);
    }
    this.u8(0);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/** Encode a complete DNS message. */
export function encodeMessage(message: DnsMessage): Uint8Array {
  const writer = new Writer();
  const h = message.header;

  let flags = 0;
  if (h.isResponse) flags |= 0x8000;
  flags |= (h.opcode & 0x0f) << 11;
  if (h.authoritative) flags |= 0x0400;
  if (h.truncated) flags |= 0x0200;
  if (h.recursionDesired) flags |= 0x0100;
  if (h.recursionAvailable) flags |= 0x0080;
  flags |= h.rcode & 0x000f;

  writer.u16(h.id);
  writer.u16(flags);
  writer.u16(message.questions.length);
  writer.u16(message.answers.length);
  writer.u16(message.authorities.length);
  writer.u16(message.additionals.length);

  for (const q of message.questions) encodeQuestion(writer, q);
  for (const rr of message.answers) encodeRecord(writer, rr);
  for (const rr of message.authorities) encodeRecord(writer, rr);
  for (const rr of message.additionals) encodeRecord(writer, rr);

  return writer.finish();
}

function encodeQuestion(writer: Writer, q: DnsQuestion): void {
  writer.name(q.name);
  writer.u16(q.type);
  writer.u16((q.class & 0x7fff) | (q.unicastResponse ? 0x8000 : 0));
}

function encodeRecord(writer: Writer, rr: ResourceRecord): void {
  writer.name(rr.name);
  writer.u16(rr.type);
  writer.u16((rr.class & 0x7fff) | (rr.flush ? 0x8000 : 0));
  writer.u32(rr.ttl >>> 0);

  const setLength = writer.reserveU16();
  const start = writer.offset;

  if (isA(rr)) {
    for (let i = 0; i < 4; i++) writer.u8(rr.data.address[i] ?? 0);
  } else if (isAAAA(rr)) {
    writer.bytes(encodeIpv6(rr.data.address));
  } else if (isPTR(rr)) {
    writer.name(rr.data.name);
  } else if (isTXT(rr)) {
    encodeTxt(writer, rr.data.attributes);
  } else if (isSRV(rr)) {
    writer.u16(rr.data.priority);
    writer.u16(rr.data.weight);
    writer.u16(rr.data.port);
    writer.name(rr.data.target);
  } else if (isNSEC(rr)) {
    writer.name(rr.data.nextDomainName);
    encodeNsecBitmap(writer, rr.data.types);
  } else {
    writer.bytes(rr.data.bytes);
  }

  setLength(writer.offset - start);
}

function encodeTxt(writer: Writer, attributes: TxtAttributes): void {
  const keys = Object.keys(attributes);
  if (keys.length === 0) {
    // RFC 6763 §6.1: an empty TXT record is a single zero-length string.
    writer.u8(0);
    return;
  }
  for (const key of keys) {
    const value = attributes[key];
    const keyBytes = latin1Bytes(key);
    let entry: Uint8Array;
    if (value === true) {
      entry = keyBytes;
    } else if (value === null || value === undefined) {
      entry = concat(keyBytes, EQUALS);
    } else {
      entry = concat(keyBytes, EQUALS, value);
    }
    if (entry.byteLength > 255) {
      throw new RangeError(`TXT attribute "${key}" exceeds 255 bytes`);
    }
    writer.u8(entry.byteLength);
    writer.bytes(entry);
  }
}

function encodeNsecBitmap(writer: Writer, types: number[]): void {
  // Restricted single-window (window 0) form used by mDNS (RFC 6762 §6.1).
  const inWindow = types.filter((t) => t >= 0 && t <= 255);
  if (inWindow.length === 0) {
    writer.u8(0);
    writer.u8(0);
    return;
  }
  const maxType = Math.max(...inWindow);
  const bitmapLength = Math.floor(maxType / 8) + 1;
  const bitmap = new Uint8Array(bitmapLength);
  for (const t of inWindow) {
    const idx = Math.floor(t / 8);
    bitmap[idx] = (bitmap[idx] as number) | (1 << (7 - (t % 8)));
  }
  writer.u8(0);
  writer.u8(bitmapLength);
  writer.bytes(bitmap);
}

const EQUALS = new Uint8Array([0x3d]);

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

function latin1Bytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

/** Encode a canonical IPv6 string (possibly with `::`) into 16 bytes. */
export function encodeIpv6(address: string): Uint8Array {
  const bytes = new Uint8Array(16);
  const halves = address.split("::");
  if (halves.length > 2) {
    throw new RangeError(`invalid IPv6 address "${address}"`);
  }

  const head = halves[0] ? (halves[0] as string).split(":") : [];
  const tail = halves.length === 2 && halves[1]
    ? (halves[1] as string).split(":")
    : [];

  const groups: number[] = [];
  for (const g of head) groups.push(parseGroup(g, address));

  if (halves.length === 2) {
    const zeros = 8 - head.length - tail.length;
    if (zeros < 0) throw new RangeError(`invalid IPv6 address "${address}"`);
    for (let i = 0; i < zeros; i++) groups.push(0);
    for (const g of tail) groups.push(parseGroup(g, address));
  }

  if (groups.length !== 8) {
    throw new RangeError(`invalid IPv6 address "${address}"`);
  }

  for (let i = 0; i < 8; i++) {
    const value = groups[i] as number;
    bytes[i * 2] = (value >> 8) & 0xff;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function parseGroup(group: string, address: string): number {
  if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
    throw new RangeError(`invalid IPv6 group "${group}" in "${address}"`);
  }
  return parseInt(group, 16);
}

// Re-export DnsClass/ResourceType so encode consumers get a single import site.
export { DnsClass, ResourceType };
