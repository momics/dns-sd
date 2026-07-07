/**
 * The low-level transport seam. A runtime with native UDP (Deno, Node.js)
 * supplies a {@link DatagramTransport}; the shared mDNS engine then drives real
 * multicast DNS traffic over it. This is the primary discovery path for
 * runtimes that can do raw multicast.
 *
 * @module
 */

/** The IPv4 mDNS multicast group address (RFC 6762 §3). */
export const MDNS_IPV4 = "224.0.0.251";
/** The IPv6 mDNS multicast group address (RFC 6762 §3). */
export const MDNS_IPV6 = "ff02::fb";
/** The mDNS UDP port (RFC 6762 §3). */
export const MDNS_PORT = 5353;

/** The IP family a transport operates on. */
export type IpFamily = "IPv4" | "IPv6";

/** The source of a received datagram. */
export interface DatagramSource {
  /** The sender's IP address. */
  address: string;
  /** The sender's UDP port. */
  port: number;
  family: IpFamily;
}

/** A received datagram together with where it came from. */
export interface ReceivedDatagram {
  data: Uint8Array;
  source: DatagramSource;
}

/**
 * Abstracts a UDP socket joined to the mDNS multicast group. Implementations
 * live in the per-runtime packages (e.g. `@momics/dns-sd-deno`,
 * `@momics/dns-sd-node`) and in the in-memory loopback transport used for
 * testing.
 *
 * The engine only requires `send`, `receive`, `localAddresses` and `close`;
 * the `setMulticastTtl` / `setMulticastLoopback` hooks are optional tuning
 * points the engine will use if present.
 */
export interface DatagramTransport {
  /** Which IP family this transport handles. */
  readonly family: IpFamily;
  /** A stable host name for this machine, used to derive an advertise host. */
  readonly hostname: string;

  /**
   * Send a datagram to the mDNS multicast group
   * (`224.0.0.251:5353` / `[ff02::fb]:5353`).
   */
  send(data: Uint8Array): Promise<void>;

  /**
   * Resolve with the next received datagram, or `null` once the transport is
   * closed. Must never reject for ordinary end-of-stream; reserve rejection
   * for genuine I/O errors.
   */
  receive(): Promise<ReceivedDatagram | null>;

  /**
   * The set of local IP addresses belonging to this host, used to ignore our
   * own multicast echoes.
   */
  localAddresses(): string[];

  /** Set the multicast TTL (IPv4). Optional. */
  setMulticastTtl?(ttl: number): void | Promise<void>;
  /** Enable/disable multicast loopback. Optional. */
  setMulticastLoopback?(enabled: boolean): void | Promise<void>;

  /** Close the socket and release resources. Idempotent. */
  close(): void | Promise<void>;
}
