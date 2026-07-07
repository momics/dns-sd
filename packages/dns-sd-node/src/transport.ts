/**
 * A Node.js {@link DatagramTransport} built on `node:dgram`. It joins the mDNS
 * multicast group on every suitable local interface, sends and receives real
 * multicast DNS traffic, and adapts Node's event-based socket into the shared
 * engine's promise-based `receive()` contract.
 *
 * @module
 */

import dgram from "node:dgram";
import os from "node:os";
import process from "node:process";
import { Buffer } from "node:buffer";
import type {
  DatagramTransport,
  IpFamily,
  ReceivedDatagram,
} from "@momics/dns-sd-shared";
import { MDNS_IPV4, MDNS_IPV6, MDNS_PORT } from "@momics/dns-sd-shared";

/** Options for constructing a {@link NodeTransport}. */
export interface NodeTransportOptions {
  /** IP family to operate on. Defaults to `"IPv4"`. */
  family?: IpFamily;
  /**
   * A stable host name used to derive the advertised host record. Defaults to
   * `os.hostname()` (with a `.local` suffix ensured).
   */
  hostname?: string;
  /** The multicast/UDP port to bind. Defaults to {@link MDNS_PORT} (5353). */
  port?: number;
  /** Multicast TTL for outgoing packets (RFC 6762 recommends 255). Defaults to 255. */
  multicastTtl?: number;
  /**
   * Whether outgoing multicast is looped back to sockets on this host. Defaults
   * to `true` so that other mDNS stacks — and, in tests, sibling transports —
   * on the same machine can see our traffic. Our own echoes are filtered out
   * inside the transport regardless of this setting.
   */
  multicastLoopback?: boolean;
  /**
   * Override the addresses reported by {@link localAddresses}. When omitted the
   * transport auto-detects this host's non-internal addresses for the chosen
   * family.
   *
   * The shared engine treats these as "our own" addresses and ignores inbound
   * datagrams whose source matches, so it can distinguish peers by address.
   * Passing `[]` disables that address-based filtering — useful when running
   * multiple transports on a single host (e.g. the conformance suite), where
   * every socket shares the host's IP. Self-echoes are still suppressed by the
   * transport, so `[]` is safe.
   */
  localAddresses?: string[];
  /**
   * Restrict multicast membership to interfaces with these addresses. When
   * omitted, membership is added on every suitable non-internal interface.
   */
  interfaces?: string[];
}

/** Fingerprint bookkeeping for suppressing our own looped-back datagrams. */
interface SentEcho {
  count: number;
  expiresAt: number;
}

const SELF_ECHO_TTL_MS = 5000;

/**
 * A UDP-multicast {@link DatagramTransport} for Node.js.
 *
 * Construct one and hand it to `createDnsSd({ transport })` (or use the
 * convenience {@link browse} / {@link advertise} helpers in the package root).
 */
export class NodeTransport implements DatagramTransport {
  readonly family: IpFamily;
  readonly hostname: string;

  private readonly socket: dgram.Socket;
  private readonly port: number;
  private readonly group: string;
  private readonly multicastTtl: number;
  private readonly multicastLoopback: boolean;
  private readonly interfaceFilter: Set<string> | null;
  private readonly ownAddresses: string[] | null;

  /** Pending inbound datagrams awaiting a `receive()` consumer. */
  private readonly inbox: ReceivedDatagram[] = [];
  /** A parked `receive()` waiting for the next datagram. */
  private waiting: ((value: ReceivedDatagram | null) => void) | null = null;
  /** Datagrams we sent recently, keyed by content, to drop our own echoes. */
  private readonly sentEchoes = new Map<string, SentEcho>();

  private readyPromise: Promise<void> | null = null;
  private closed = false;

  constructor(options: NodeTransportOptions = {}) {
    this.family = options.family ?? "IPv4";
    this.hostname = ensureLocal(options.hostname ?? os.hostname());
    this.port = options.port ?? MDNS_PORT;
    this.group = this.family === "IPv4" ? MDNS_IPV4 : MDNS_IPV6;
    this.multicastTtl = options.multicastTtl ?? 255;
    this.multicastLoopback = options.multicastLoopback ?? true;
    this.interfaceFilter = options.interfaces
      ? new Set(options.interfaces)
      : null;
    this.ownAddresses = options.localAddresses ?? null;

    this.socket = dgram.createSocket({
      type: this.family === "IPv4" ? "udp4" : "udp6",
      reuseAddr: true,
    });

    this.socket.on("message", (msg, rinfo) => this.onMessage(msg, rinfo));
    this.socket.on("error", (err) => this.onError(err));
  }

  /**
   * Bind the socket, join the multicast group and apply multicast options.
   * Idempotent: repeated calls (and the lazy call inside `send`/`receive`)
   * share a single bind.
   */
  ready(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.socket.once("error", onError);
      this.socket.bind(this.port, () => {
        this.socket.removeListener("error", onError);
        try {
          this.configureSocket();
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
    return this.readyPromise;
  }

  private configureSocket(): void {
    try {
      this.socket.setMulticastLoopback(this.multicastLoopback);
    } catch {
      // Not fatal: some platforms disallow toggling loopback.
    }
    if (this.family === "IPv4") {
      try {
        this.socket.setMulticastTTL(this.multicastTtl);
      } catch {
        // Ignore: TTL tuning is best-effort.
      }
    }
    this.joinGroup();
  }

  private joinGroup(): void {
    const interfaces = this.membershipInterfaces();
    if (interfaces.length === 0) {
      // Fall back to the default interface if none matched.
      try {
        this.socket.addMembership(this.group);
      } catch {
        // Ignore: membership may already exist.
      }
      return;
    }
    for (const iface of interfaces) {
      try {
        this.socket.addMembership(this.group, iface);
      } catch {
        // Ignore per-interface failures (already joined, unusable iface, …).
      }
    }
  }

  /** The interface addresses to join the multicast group on. */
  private membershipInterfaces(): string[] {
    const wantV6 = this.family === "IPv6";
    const result: string[] = [];
    for (const infos of Object.values(os.networkInterfaces())) {
      if (!infos) continue;
      for (const info of infos) {
        if (info.internal) continue;
        if (isV6(info.family) !== wantV6) continue;
        if (this.interfaceFilter && !this.interfaceFilter.has(info.address)) {
          continue;
        }
        // Skip IPv6 link-local without scope handling headaches unless the
        // caller explicitly asked for that address.
        result.push(info.address);
      }
    }
    return result;
  }

  send(data: Uint8Array): Promise<void> {
    if (this.closed) return Promise.resolve();
    // The engine fires sends without awaiting them, so this must never reject:
    // surface failures as warnings and resolve, and shut the transport down on
    // a fatal bind error so the receive loop can end cleanly.
    return this.ready().then(
      () =>
        new Promise<void>((resolve) => {
          if (this.closed) return resolve();
          this.rememberSent(data);
          this.socket.send(
            data,
            0,
            data.length,
            this.port,
            this.group,
            (err) => {
              if (err) this.warn(`send failed: ${err.message}`);
              resolve();
            },
          );
        }),
      (err) => {
        this.warn(`bind failed: ${errorMessage(err)}`);
        this.close();
      },
    );
  }

  receive(): Promise<ReceivedDatagram | null> {
    if (this.closed) return Promise.resolve(null);
    const buffered = this.inbox.shift();
    if (buffered) return Promise.resolve(buffered);
    // Trigger the bind so messages start flowing, but don't await it here: a
    // fatal bind error closes the transport (which resolves the parked waiter
    // below with null), and closing while a bind is still pending must not hang.
    this.ready().catch((err) => {
      this.warn(`bind failed: ${errorMessage(err)}`);
      this.close();
    });
    return new Promise<ReceivedDatagram | null>((resolve) => {
      this.waiting = resolve;
    });
  }

  localAddresses(): string[] {
    if (this.ownAddresses) return [...this.ownAddresses];
    const wantV6 = this.family === "IPv6";
    const addresses: string[] = [];
    for (const infos of Object.values(os.networkInterfaces())) {
      if (!infos) continue;
      for (const info of infos) {
        if (info.internal) continue;
        if (isV6(info.family) !== wantV6) continue;
        addresses.push(info.address);
      }
    }
    return addresses;
  }

  setMulticastTtl(ttl: number): void {
    if (this.family !== "IPv4") return;
    try {
      this.socket.setMulticastTTL(ttl);
    } catch {
      // Best-effort.
    }
  }

  setMulticastLoopback(enabled: boolean): void {
    try {
      this.socket.setMulticastLoopback(enabled);
    } catch {
      // Best-effort.
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // Already closing/closed.
    }
    this.sentEchoes.clear();
    this.inbox.length = 0;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(null);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    if (this.closed) return;
    const data = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
    if (this.isOwnEcho(data)) return;
    const datagram: ReceivedDatagram = {
      // Copy so the shared engine owns a stable buffer independent of Node's.
      data: data.slice(),
      source: {
        address: rinfo.address,
        port: rinfo.port,
        family: rinfo.family === "IPv6" ? "IPv6" : "IPv4",
      },
    };
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(datagram);
    } else {
      this.inbox.push(datagram);
    }
  }

  private onError(err: Error): void {
    // A socket error after bind (e.g. a transient send failure) shouldn't crash
    // the process. Warn and keep going; a fatal bind error surfaces via the
    // bind rejection handled in `send`/`receive`.
    if (this.closed) return;
    this.warn(`socket error: ${err.message}`);
  }

  private warn(message: string): void {
    process.emitWarning(`NodeTransport: ${message}`, "DnsSdWarning");
  }

  /** Record a datagram we're about to send so we can drop its loopback echo. */
  private rememberSent(data: Uint8Array): void {
    this.pruneSentEchoes();
    const key = fingerprint(data);
    const existing = this.sentEchoes.get(key);
    const expiresAt = Date.now() + SELF_ECHO_TTL_MS;
    if (existing) {
      existing.count++;
      existing.expiresAt = expiresAt;
    } else {
      this.sentEchoes.set(key, { count: 1, expiresAt });
    }
  }

  /** True if `data` matches a datagram we recently sent (our own echo). */
  private isOwnEcho(data: Uint8Array): boolean {
    const key = fingerprint(data);
    const entry = this.sentEchoes.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) this.sentEchoes.delete(key);
      return false;
    }
    entry.count--;
    if (entry.count <= 0) this.sentEchoes.delete(key);
    return true;
  }

  private pruneSentEchoes(): void {
    const now = Date.now();
    for (const [key, entry] of this.sentEchoes) {
      if (entry.expiresAt < now) this.sentEchoes.delete(key);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function ensureLocal(hostname: string): string {
  const trimmed = hostname.trim();
  const base = trimmed.length > 0 ? trimmed : "host";
  return /\.local\.?$/i.test(base) ? base : `${base}.local`;
}

function isV6(family: string | number): boolean {
  // Node <18 reported numeric families (4/6); newer versions use "IPv4"/"IPv6".
  return family === "IPv6" || family === 6;
}

/**
 * A cheap content fingerprint (length + FNV-1a hash) used to recognise our own
 * looped-back datagrams. Collisions only risk dropping a peer packet that is
 * byte-identical to one we just sent, which does not occur for the distinct
 * records each node advertises.
 */
function fingerprint(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i] as number;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${data.length}:${(hash >>> 0).toString(16)}`;
}
