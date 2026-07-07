/**
 * Utilities for comparing and identifying resource records: canonical RDATA
 * encoding (for lexicographic conflict tie-breaking, RFC 6762 §8.2.1), record
 * identity keys, and conflict detection.
 *
 * @module
 */

import {
  isA,
  isAAAA,
  isNSEC,
  isPTR,
  isSRV,
  isTXT,
  type ResourceRecord,
} from "../wire/types.ts";
import { encodeIpv6 } from "../wire/encode.ts";
import { nameKey } from "../naming.ts";

/** A stable identity key for a record: name + type + canonical RDATA. */
export function recordKey(rr: ResourceRecord): string {
  return `${nameKey(rr.name)}|${rr.type}|${bytesToHex(canonicalRdata(rr))}`;
}

/** A name+type key, ignoring RDATA (used for cache-flush grouping). */
export function recordNameTypeKey(rr: ResourceRecord): string {
  return `${nameKey(rr.name)}|${rr.type}`;
}

/**
 * Canonical, uncompressed RDATA encoding used for record comparison. Names are
 * lower-cased and written without compression per the canonical form rules.
 */
export function canonicalRdata(rr: ResourceRecord): Uint8Array {
  if (isA(rr)) return Uint8Array.from(rr.data.address.slice(0, 4));
  if (isAAAA(rr)) return encodeIpv6(rr.data.address);
  if (isPTR(rr)) return canonicalName(rr.data.name);
  if (isSRV(rr)) {
    const head = new Uint8Array(6);
    const dv = new DataView(head.buffer);
    dv.setUint16(0, rr.data.priority);
    dv.setUint16(2, rr.data.weight);
    dv.setUint16(4, rr.data.port);
    return concat(head, canonicalName(rr.data.target));
  }
  if (isTXT(rr)) {
    const parts: Uint8Array[] = [];
    // TXT ordering is significant to the wire form; preserve insertion order.
    for (const key of Object.keys(rr.data.attributes)) {
      const value = rr.data.attributes[key];
      const keyBytes = latin1(key);
      let entry: Uint8Array;
      if (value === true) entry = keyBytes;
      else if (value === null || value === undefined) {
        entry = concat(keyBytes, EQUALS);
      } else entry = concat(keyBytes, EQUALS, value);
      parts.push(Uint8Array.from([entry.byteLength]), entry);
    }
    return concat(...parts);
  }
  if (isNSEC(rr)) return canonicalName(rr.data.nextDomainName);
  return rr.data.bytes;
}

/** Lexicographically compare two records' RDATA. Returns -1, 0 or 1. */
export function compareRdata(a: ResourceRecord, b: ResourceRecord): -1 | 0 | 1 {
  const ab = canonicalRdata(a);
  const bb = canonicalRdata(b);
  const len = Math.max(ab.byteLength, bb.byteLength);
  for (let i = 0; i < len; i++) {
    const av = i < ab.byteLength ? (ab[i] as number) : -1;
    const bv = i < bb.byteLength ? (bb[i] as number) : -1;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/** Lexicographically compare two records by class, type, then RDATA. */
export function recordSort(a: ResourceRecord, b: ResourceRecord): -1 | 0 | 1 {
  if (a.class !== b.class) return a.class < b.class ? -1 : 1;
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  return compareRdata(a, b);
}

/**
 * Two unique (cache-flush) records conflict when they share a name and type
 * but differ in RDATA (RFC 6762 §9).
 */
export function isConflicting(a: ResourceRecord, b: ResourceRecord): boolean {
  if (a.type !== b.type) return false;
  if (nameKey(a.name) !== nameKey(b.name)) return false;
  return compareRdata(a, b) !== 0;
}

function canonicalName(labels: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const label of labels) {
    const bytes = latin1(label.toLowerCase());
    parts.push(Uint8Array.from([bytes.byteLength]), bytes);
  }
  parts.push(Uint8Array.from([0]));
  return concat(...parts);
}

const EQUALS = new Uint8Array([0x3d]);

function latin1(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

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

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] as number).toString(16).padStart(2, "0");
  }
  return hex;
}
