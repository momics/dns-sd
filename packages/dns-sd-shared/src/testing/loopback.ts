/**
 * An in-memory {@link DatagramTransport} backed by a virtual multicast bus.
 * Multiple virtual nodes attach to one {@link VirtualBus} and exchange real,
 * fully-encoded mDNS packets entirely in-process — no sockets, no network. This
 * makes the whole engine deterministically testable.
 *
 * A datagram sent by one node is delivered to every *other* node on the bus
 * (mirroring the common real-world case where multicast loopback to the sender
 * is disabled), which is why a single node cannot discover its own
 * advertisement — use two nodes for browse↔advertise tests.
 *
 * @module
 */

import type {
  DatagramTransport,
  IpFamily,
  ReceivedDatagram,
} from "../seams/transport.ts";
import { FastFIFO } from "../fast_fifo.ts";

interface BusMember {
  address: string;
  deliver(datagram: ReceivedDatagram): void;
}

/** A virtual multicast segment that fans datagrams out to attached nodes. */
export class VirtualBus {
  private readonly members = new Set<BusMember>();
  /** Total datagrams that have crossed the bus (useful for test assertions). */
  packetCount = 0;

  private attach(member: BusMember): () => void {
    this.members.add(member);
    return () => this.members.delete(member);
  }

  private publish(from: BusMember, data: Uint8Array): void {
    this.packetCount++;
    for (const member of this.members) {
      if (member === from) continue;
      // Copy so mutations by one receiver can't affect another.
      member.deliver({
        data: data.slice(),
        source: { address: from.address, port: 5353, family: "IPv4" },
      });
    }
  }

  /**
   * Create a new {@link DatagramTransport} attached to this bus, with a unique
   * virtual address and host name.
   */
  createTransport(options: {
    address?: string;
    hostname?: string;
    family?: IpFamily;
  } = {}): LoopbackTransport {
    const address = options.address ?? this.nextAddress();
    const member: BusMember = {
      address,
      deliver: () => {},
    };
    const transport = new LoopbackTransport({
      address,
      hostname: options.hostname ?? `node-${address.replace(/\./g, "-")}.local`,
      family: options.family ?? "IPv4",
      send: (data) => this.publish(member, data),
      onAttach: (deliver) => {
        member.deliver = deliver;
        return this.attach(member);
      },
    });
    return transport;
  }

  private counter = 0;
  private nextAddress(): string {
    this.counter++;
    return `10.0.0.${this.counter}`;
  }
}

interface LoopbackConfig {
  address: string;
  hostname: string;
  family: IpFamily;
  send(data: Uint8Array): void;
  onAttach(deliver: (datagram: ReceivedDatagram) => void): () => void;
}

/** A {@link DatagramTransport} attached to a {@link VirtualBus}. */
export class LoopbackTransport implements DatagramTransport {
  readonly family: IpFamily;
  readonly hostname: string;
  readonly address: string;

  private readonly config: LoopbackConfig;
  private readonly inbox = new FastFIFO<ReceivedDatagram>();
  private readonly detach: () => void;
  private closed = false;

  constructor(config: LoopbackConfig) {
    this.config = config;
    this.family = config.family;
    this.hostname = config.hostname;
    this.address = config.address;
    this.detach = config.onAttach((datagram) => {
      if (!this.closed) this.inbox.push(datagram);
    });
    this.iterator = this.inbox[Symbol.asyncIterator]();
  }

  private readonly iterator: AsyncIterator<ReceivedDatagram>;

  send(data: Uint8Array): Promise<void> {
    if (!this.closed) this.config.send(data);
    return Promise.resolve();
  }

  async receive(): Promise<ReceivedDatagram | null> {
    if (this.closed) return null;
    const { value, done } = await this.iterator.next();
    if (done) return null;
    return value;
  }

  localAddresses(): string[] {
    return [this.address];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.inbox.close();
  }
}
