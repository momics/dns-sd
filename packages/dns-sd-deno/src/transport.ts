/**
 * A {@link DatagramTransport} backed by a real Deno UDP multicast socket
 * ({@linkcode Deno.listenDatagram}). This is the production discovery path for
 * Deno: the shared mDNS engine drives real RFC 6762 traffic over it.
 *
 * Requires the `net` permission (`--allow-net`), the unstable net APIs
 * (`--unstable-net`, for multicast join), and — to enumerate local addresses —
 * the `sys` permission (`--allow-sys`).
 *
 * @module
 */

import {
  type DatagramTransport,
  type IpFamily,
  MDNS_IPV4,
  MDNS_IPV6,
  MDNS_PORT,
  type ReceivedDatagram,
} from "@momics/dns-sd-shared";
import { localHostname, localInterfaceAddresses } from "./addresses.ts";

/** Options for constructing a {@link DenoTransport}. */
export interface DenoTransportOptions {
  /** IP family to operate on. Defaults to `"IPv4"`. */
  family?: IpFamily;
  /** UDP port to bind and send to. Defaults to {@link MDNS_PORT} (5353). */
  port?: number;
  /**
   * Multicast group address. Defaults to {@link MDNS_IPV4} / {@link MDNS_IPV6}
   * for the chosen family.
   */
  group?: string;
  /**
   * IPv4 multicast membership interface address (the local interface to join
   * on). Defaults to `"0.0.0.0"` (any interface).
   */
  interfaceAddress?: string;
  /**
   * IPv6 multicast membership interface index. Defaults to `0` (any interface).
   */
  interfaceIndex?: number;
  /**
   * Host name used to derive the advertise host when a service doesn't specify
   * one. Defaults to {@linkcode Deno.hostname}.
   */
  hostname?: string;
  /**
   * Override the local addresses reported to the engine. The engine uses these
   * both to build advertised A/AAAA records and to ignore our own multicast
   * echoes (by source IP). Defaults to this host's non-internal addresses for
   * the family.
   *
   * Pass `[]` to run multiple nodes on ONE host (e.g. the conformance suite):
   * the engine's IP-based own-echo filter is then a no-op so siblings aren't
   * hidden, `localAddresses()` falls back to loopback so advertised services
   * still carry an address, and this transport suppresses our own loopback
   * datagrams itself.
   */
  localAddresses?: string[];
  /** Enable multicast loopback so co-located sockets hear each other. Defaults to `true`. */
  multicastLoopback?: boolean;
  /** Initial multicast TTL (IPv4 only). */
  multicastTtl?: number;
}

type MembershipV4 = Awaited<ReturnType<Deno.DatagramConn["joinMulticastV4"]>>;
type MembershipV6 = Awaited<ReturnType<Deno.DatagramConn["joinMulticastV6"]>>;

/** How long a sent datagram stays eligible for echo suppression. */
const ECHO_WINDOW_MS = 2000;
/** Cap on tracked sends, in case loopback echoes never arrive to consume them. */
const ECHO_MAX_ENTRIES = 256;

/** A cheap, exact key for a datagram's bytes (length-tagged binary string). */
function echoKey(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i] as number);
  }
  return `${data.length}:${binary}`;
}

/** A UDP-multicast {@link DatagramTransport} implemented with Deno's socket API. */
export class DenoTransport implements DatagramTransport {
  readonly family: IpFamily;
  readonly hostname: string;
  /** The multicast group this transport sends to. */
  readonly group: string;
  /** The UDP port this transport binds and sends to. */
  readonly port: number;

  private readonly conn: Deno.DatagramConn;
  private readonly membership: Promise<MembershipV4 | MembershipV6 | null>;
  private readonly addresses: string[];
  private closed = false;

  // Transport-level self-echo suppression: multicast loopback delivers our own
  // datagrams back to us. We record the bytes of everything we send and drop a
  // matching received datagram exactly once. This lets `localAddresses()` return
  // an empty/loopback value (so multiple nodes can share one host without the
  // engine's IP-based own-echo filter hiding siblings) while still not
  // reprocessing our own traffic.
  private readonly recentSends: { key: string; at: number }[] = [];

  constructor(options: DenoTransportOptions = {}) {
    this.family = options.family ?? "IPv4";
    this.port = options.port ?? MDNS_PORT;
    this.group = options.group ??
      (this.family === "IPv4" ? MDNS_IPV4 : MDNS_IPV6);
    this.hostname = options.hostname ?? localHostname();
    this.addresses = options.localAddresses ??
      localInterfaceAddresses(this.family);

    const bindHost = this.family === "IPv4" ? "0.0.0.0" : "::";
    this.conn = Deno.listenDatagram({
      hostname: bindHost,
      port: this.port,
      reuseAddress: true,
      loopback: options.multicastLoopback ?? true,
      transport: "udp",
    });

    // Join the multicast group. A failed join (e.g. the family has no multicast
    // route on this host) must not crash the runtime with an unhandled
    // rejection: the transport degrades to receive-only and multicast simply
    // won't flow. Errors are swallowed here by resolving to `null`.
    const join = this.family === "IPv4"
      ? this.conn.joinMulticastV4(
        this.group,
        options.interfaceAddress ?? "0.0.0.0",
      )
      : this.conn.joinMulticastV6(this.group, options.interfaceIndex ?? 0);
    this.membership = join.catch(() => null);

    // Apply optional tuning once the membership resolves.
    if (options.multicastLoopback !== undefined) {
      void this.setMulticastLoopback(options.multicastLoopback);
    }
    if (options.multicastTtl !== undefined) {
      void this.setMulticastTtl(options.multicastTtl);
    }
  }

  async send(data: Uint8Array): Promise<void> {
    if (this.closed) return;
    // Record before sending: a loopback echo can arrive before `send` resolves.
    this.rememberSend(data);
    try {
      await this.conn.send(data, {
        hostname: this.group,
        port: this.port,
        transport: "udp",
      });
    } catch {
      // Multicast send is best-effort (RFC 6762). Swallow transient errors
      // (e.g. "No route to host" on a network that blocks multicast, or a send
      // racing with close) rather than crashing the engine's send path.
    }
  }

  async receive(): Promise<ReceivedDatagram | null> {
    while (!this.closed) {
      let data: Uint8Array;
      let netAddr: Deno.NetAddr;
      try {
        const [bytes, addr] = await this.conn.receive();
        data = bytes;
        netAddr = addr as Deno.NetAddr;
      } catch {
        // The socket was closed (BadResource) or interrupted: signal EOF with
        // `null` rather than rejecting, per the DatagramTransport contract.
        return null;
      }
      // Drop our own multicast loopback so we don't reprocess our own traffic.
      if (this.isOwnEcho(data)) continue;
      return {
        data,
        source: {
          address: netAddr.hostname,
          port: netAddr.port,
          family: this.family,
        },
      };
    }
    return null;
  }

  localAddresses(): string[] {
    // A non-empty configured/discovered set is used verbatim: on a real network
    // this gives correct cross-host A/AAAA records and lets the engine filter
    // our own echoes by source IP. When empty (e.g. the conformance harness runs
    // several nodes on one host and passes `[]` so siblings aren't filtered out),
    // fall back to loopback so advertised services still carry an address.
    if (this.addresses.length > 0) return [...this.addresses];
    return this.family === "IPv4" ? ["127.0.0.1"] : ["::1"];
  }

  /** Record the bytes of an outgoing datagram for later echo suppression. */
  private rememberSend(data: Uint8Array): void {
    const now = Date.now();
    this.pruneSends(now);
    this.recentSends.push({ key: echoKey(data), at: now });
    // Bound memory if echoes never come back (e.g. loopback disabled).
    if (this.recentSends.length > ECHO_MAX_ENTRIES) this.recentSends.shift();
  }

  /** Whether `data` matches a datagram we recently sent (consumes the match). */
  private isOwnEcho(data: Uint8Array): boolean {
    const now = Date.now();
    this.pruneSends(now);
    const key = echoKey(data);
    const index = this.recentSends.findIndex((e) => e.key === key);
    if (index === -1) return false;
    this.recentSends.splice(index, 1);
    return true;
  }

  private pruneSends(now: number): void {
    while (
      this.recentSends.length > 0 &&
      now - (this.recentSends[0]?.at ?? now) > ECHO_WINDOW_MS
    ) {
      this.recentSends.shift();
    }
  }

  async setMulticastTtl(ttl: number): Promise<void> {
    if (this.family !== "IPv4") return;
    const membership = await this.membership;
    if (this.closed || !membership) return;
    try {
      (membership as MembershipV4).setTTL(ttl);
    } catch {
      // Socket closed between the await and here — nothing to tune.
    }
  }

  async setMulticastLoopback(enabled: boolean): Promise<void> {
    const membership = await this.membership;
    if (this.closed || !membership) return;
    try {
      membership.setLoopback(enabled);
    } catch {
      // Socket closed between the await and here — nothing to tune.
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn.close();
    } catch {
      // Already closed.
    }
  }
}
