/**
 * Shared, representative inputs for the hot-path benchmarks.
 *
 * The fixtures model a *typical DNS-SD browse response* — the packet an mDNS
 * responder emits when answering `_http._tcp.local` — carrying the full set of
 * records a resolver must chew through on every received datagram: a `PTR`
 * pointing at a service instance, its `SRV` and `TXT`, and the host's `A` /
 * `AAAA` address records (RFC 6763 §12.1). This is the shape that dominates the
 * codec and cache hot paths in practice, so benchmarking it (rather than a
 * synthetic micro-input) keeps the numbers honest.
 *
 * These are plain data builders with no I/O and no dependency on the test
 * harness, so they are safe to import from `Deno.bench` files.
 *
 * @module
 */

import {
  DnsClass,
  type DnsMessage,
  encodeMessage,
  type ResourceRecord,
  ResourceType,
  type TxtAttributes,
} from "../src/wire/index.ts";

/** Build the `TxtAttributes` for a representative DNS-SD service instance. */
export function browseTxtAttributes(): TxtAttributes {
  const enc = new TextEncoder();
  return {
    txtvers: enc.encode("1"),
    path: enc.encode("/index.html"),
    u: enc.encode("admin"),
    p: enc.encode("s3cr3t"),
    color: enc.encode("blue"),
    flag: true,
    empty: null,
  };
}

/**
 * A typical browse response for `_http._tcp.local`, populated the way an
 * mDNS responder answers a browse query: the `PTR` in the answer section and
 * the instance's `SRV` / `TXT` / `A` / `AAAA` in the additional section.
 */
export function browseResponse(): DnsMessage {
  const service = ["_http", "_tcp", "local"];
  const instance = ["My Web Server", "_http", "_tcp", "local"];
  const host = ["my-web-server", "local"];

  const ptr: ResourceRecord = {
    name: service,
    type: ResourceType.PTR,
    class: DnsClass.IN,
    ttl: 4500,
    flush: false,
    data: { kind: "PTR", name: instance },
  };
  const srv: ResourceRecord = {
    name: instance,
    type: ResourceType.SRV,
    class: DnsClass.IN,
    ttl: 120,
    flush: true,
    data: { kind: "SRV", priority: 0, weight: 0, port: 80, target: host },
  };
  const txt: ResourceRecord = {
    name: instance,
    type: ResourceType.TXT,
    class: DnsClass.IN,
    ttl: 4500,
    flush: true,
    data: { kind: "TXT", attributes: browseTxtAttributes() },
  };
  const a: ResourceRecord = {
    name: host,
    type: ResourceType.A,
    class: DnsClass.IN,
    ttl: 120,
    flush: true,
    data: { kind: "A", address: [192, 168, 1, 42] },
  };
  const aaaa: ResourceRecord = {
    name: host,
    type: ResourceType.AAAA,
    class: DnsClass.IN,
    ttl: 120,
    flush: true,
    data: { kind: "AAAA", address: "fe80::1c2d:3e4f:5a6b:7c8d" },
  };

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
    answers: [ptr],
    authorities: [],
    additionals: [srv, txt, a, aaaa],
  };
}

/** The wire bytes of {@link browseResponse}, for decode benchmarks. */
export function browseResponseBytes(): Uint8Array {
  return encodeMessage(browseResponse());
}

/**
 * A batch of distinct records emulating a resolved browse set: `count`
 * instances, each contributing a PTR / SRV / TXT / A / AAAA, all with distinct
 * names so they land as separate cache entries.
 */
export function browseRecordBatch(count: number): ResourceRecord[] {
  const enc = new TextEncoder();
  const out: ResourceRecord[] = [];
  for (let i = 0; i < count; i++) {
    const service = ["_http", "_tcp", "local"];
    const instance = [`Instance ${i}`, "_http", "_tcp", "local"];
    const host = [`host-${i}`, "local"];
    out.push({
      name: service,
      type: ResourceType.PTR,
      class: DnsClass.IN,
      ttl: 4500,
      flush: false,
      data: { kind: "PTR", name: instance },
    });
    out.push({
      name: instance,
      type: ResourceType.SRV,
      class: DnsClass.IN,
      ttl: 120,
      flush: true,
      data: { kind: "SRV", priority: 0, weight: 0, port: 80, target: host },
    });
    out.push({
      name: instance,
      type: ResourceType.TXT,
      class: DnsClass.IN,
      ttl: 4500,
      flush: true,
      data: {
        kind: "TXT",
        attributes: { txtvers: enc.encode("1"), id: enc.encode(String(i)) },
      },
    });
    out.push({
      name: host,
      type: ResourceType.A,
      class: DnsClass.IN,
      ttl: 120,
      flush: true,
      data: { kind: "A", address: [192, 168, 1, i & 0xff] },
    });
    out.push({
      name: host,
      type: ResourceType.AAAA,
      class: DnsClass.IN,
      ttl: 120,
      flush: true,
      data: { kind: "AAAA", address: `fe80::${(i & 0xffff).toString(16)}` },
    });
  }
  return out;
}
