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
   * echoes. Defaults to this host's non-internal addresses for the family.
   *
   * Supplying a distinct value per instance lets multiple nodes coexist on one
   * host (e.g. for the conformance suite) without filtering each other out.
   */
  localAddresses?: string[];
  /** Enable multicast loopback so co-located sockets hear each other. Defaults to `true`. */
  multicastLoopback?: boolean;
  /** Initial multicast TTL (IPv4 only). */
  multicastTtl?: number;
}

type MembershipV4 = Awaited<ReturnType<Deno.DatagramConn["joinMulticastV4"]>>;
type MembershipV6 = Awaited<ReturnType<Deno.DatagramConn["joinMulticastV6"]>>;

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
    if (this.closed) return null;
    try {
      const [data, addr] = await this.conn.receive();
      const netAddr = addr as Deno.NetAddr;
      return {
        data,
        source: {
          address: netAddr.hostname,
          port: netAddr.port,
          family: this.family,
        },
      };
    } catch {
      // The socket was closed (BadResource) or interrupted: signal EOF with
      // `null` rather than rejecting, per the DatagramTransport contract.
      return null;
    }
  }

  localAddresses(): string[] {
    return [...this.addresses];
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
