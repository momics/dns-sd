/**
 * DNS wire-format types, per RFC 1035 (base DNS) with the record types and
 * flags relevant to multicast DNS / DNS-SD (RFC 6762 & RFC 6763).
 *
 * @module
 */

/** DNS CLASS values. mDNS almost exclusively uses `IN`. */
export enum DnsClass {
  /** The Internet. */
  IN = 1,
  /** The CSNET class (obsolete). */
  CS = 2,
  /** The CHAOS class. */
  CH = 3,
  /** Hesiod. */
  HS = 4,
  /** Any class (QCLASS only). */
  ANY = 255,
}

/** DNS OPCODE values (RFC 1035 §4.1.1). */
export enum Opcode {
  Query = 0,
  IQuery = 1,
  Status = 2,
}

/** DNS RCODE values (RFC 1035 §4.1.1). */
export enum Rcode {
  NoError = 0,
  FormatError = 1,
  ServerFailure = 2,
  NameError = 3,
  NotImplemented = 4,
  Refused = 5,
}

/**
 * DNS Resource Record TYPE values. Only the record types relevant to
 * multicast DNS / DNS-SD are enumerated here.
 */
export enum ResourceType {
  /** A host address (IPv4). */
  A = 1,
  /** A domain name pointer. */
  PTR = 12,
  /** Text strings (key/value attributes for DNS-SD). */
  TXT = 16,
  /** An IPv6 host address. */
  AAAA = 28,
  /** A service location record. */
  SRV = 33,
  /** Authenticated proof of non-existence of record types. */
  NSEC = 47,
  /** A request for any/all records (QTYPE only). */
  ANY = 255,
}

/**
 * A parsed DNS message header (RFC 1035 §4.1.1).
 *
 * In mDNS most flag fields are zero; the meaningful ones are `QR` (query vs.
 * response) and `AA` (authoritative answer, always set on mDNS responses).
 */
export interface DnsHeader {
  /** 16-bit transaction identifier. Zero for mDNS. */
  id: number;
  /** `false` = query, `true` = response. */
  isResponse: boolean;
  opcode: Opcode;
  /** Authoritative Answer. */
  authoritative: boolean;
  /** TrunCation. */
  truncated: boolean;
  /** Recursion Desired. */
  recursionDesired: boolean;
  /** Recursion Available. */
  recursionAvailable: boolean;
  rcode: Rcode;
}

/** A question section entry (RFC 1035 §4.1.2). */
export interface DnsQuestion {
  /** The queried name, as a sequence of labels (without a trailing empty root). */
  name: string[];
  type: ResourceType;
  class: DnsClass;
  /**
   * mDNS "unicast response" bit (RFC 6762 §5.4). When `true` the querier
   * requests a unicast (QU) rather than multicast (QM) response.
   */
  unicastResponse: boolean;
}

/** Fields common to every resource record. */
export interface ResourceRecordBase {
  /** The record's owner name, as a sequence of labels. */
  name: string[];
  type: ResourceType;
  class: DnsClass;
  /** Time-to-live, in seconds. A TTL of 0 signals a "goodbye" (RFC 6762 §10.1). */
  ttl: number;
  /**
   * mDNS cache-flush bit (RFC 6762 §10.2). When `true`, this record replaces
   * any cached records of the same name/type/class.
   */
  flush: boolean;
}

/** An `A` record: a 4-byte IPv4 address, as an array of octets. */
export interface ResourceRecordA extends ResourceRecordBase {
  type: ResourceType.A;
  data: { kind: "A"; address: number[] };
}

/** An `AAAA` record: an IPv6 address, in canonical string form. */
export interface ResourceRecordAAAA extends ResourceRecordBase {
  type: ResourceType.AAAA;
  data: { kind: "AAAA"; address: string };
}

/** A `PTR` record: points at another name (a service instance for DNS-SD). */
export interface ResourceRecordPTR extends ResourceRecordBase {
  type: ResourceType.PTR;
  data: { kind: "PTR"; name: string[] };
}

/**
 * A `TXT` record: an ordered map of key/value attributes (RFC 6763 §6).
 *
 * - `true`  — attribute present with no value (bare key, no `=`).
 * - `null`  — attribute present with an empty value (`key=`).
 * - bytes   — attribute present with a binary value (`key=<bytes>`).
 */
export interface ResourceRecordTXT extends ResourceRecordBase {
  type: ResourceType.TXT;
  data: { kind: "TXT"; attributes: TxtAttributes };
}

/** Decoded TXT attribute map. */
export type TxtAttributes = Record<string, Uint8Array | true | null>;

/** An `SRV` record: locates the host and port for a service instance. */
export interface ResourceRecordSRV extends ResourceRecordBase {
  type: ResourceType.SRV;
  data: {
    kind: "SRV";
    priority: number;
    weight: number;
    port: number;
    target: string[];
  };
}

/** An `NSEC` record: proves which record types exist for a name (RFC 6762 §6.1). */
export interface ResourceRecordNSEC extends ResourceRecordBase {
  type: ResourceType.NSEC;
  data: {
    kind: "NSEC";
    nextDomainName: string[];
    /** The record TYPEs that exist for this owner name. */
    types: number[];
  };
}

/** Any resource record whose RDATA we don't decode; RDATA is kept raw. */
export interface ResourceRecordRaw extends ResourceRecordBase {
  data: { kind: "RAW"; bytes: Uint8Array };
}

/** A decoded resource record. */
export type ResourceRecord =
  | ResourceRecordA
  | ResourceRecordAAAA
  | ResourceRecordPTR
  | ResourceRecordTXT
  | ResourceRecordSRV
  | ResourceRecordNSEC
  | ResourceRecordRaw;

/** A fully decoded DNS message. */
export interface DnsMessage {
  header: DnsHeader;
  questions: DnsQuestion[];
  answers: ResourceRecord[];
  authorities: ResourceRecord[];
  additionals: ResourceRecord[];
}

// ── Type guards ──────────────────────────────────────────────────────────────

export function isA(rr: ResourceRecord): rr is ResourceRecordA {
  return rr.type === ResourceType.A;
}
export function isAAAA(rr: ResourceRecord): rr is ResourceRecordAAAA {
  return rr.type === ResourceType.AAAA;
}
export function isPTR(rr: ResourceRecord): rr is ResourceRecordPTR {
  return rr.type === ResourceType.PTR;
}
export function isTXT(rr: ResourceRecord): rr is ResourceRecordTXT {
  return rr.type === ResourceType.TXT;
}
export function isSRV(rr: ResourceRecord): rr is ResourceRecordSRV {
  return rr.type === ResourceType.SRV;
}
export function isNSEC(rr: ResourceRecord): rr is ResourceRecordNSEC {
  return rr.type === ResourceType.NSEC;
}
