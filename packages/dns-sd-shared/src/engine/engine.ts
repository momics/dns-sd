/**
 * The runtime-agnostic mDNS engine. It owns a {@link DatagramTransport}, runs
 * the receive loop, and dispatches decoded messages to the active
 * {@link Browser}s and {@link Responder}s. It is driven by the public
 * `browse` / `advertise` API when a transport backend is supplied.
 *
 * @module
 */

import { decodeMessage } from "../wire/decode.ts";
import { encodeMessage } from "../wire/encode.ts";
import type { DnsMessage } from "../wire/types.ts";
import type { DatagramTransport } from "../seams/transport.ts";
import type {
  AdvertiseServiceSpec,
  BrowseServiceSpec,
  ServiceAnnouncement,
} from "../types.ts";
import { DEFAULT_TIMING, type EngineTiming } from "./constants.ts";
import { Browser } from "./query.ts";
import { Responder } from "./responder.ts";

/** A live browse subscription returned by {@link MdnsEngine.browse}. */
export interface MdnsBrowser {
  /** Async stream of service lifecycle events. */
  events(): AsyncIterable<ServiceAnnouncement>;
  /** Stop browsing and release resources. */
  close(): void;
}

/** A live advertisement returned by {@link MdnsEngine.advertise}. */
export interface MdnsResponder {
  /** The final, possibly conflict-renamed instance name. */
  readonly name: string;
  /** The final fully-qualified instance name. */
  readonly fullName: string;
  /** Withdraw the advertisement (sending goodbye) and release resources. */
  stop(): Promise<void>;
}

/** Options for constructing an {@link MdnsEngine}. */
export interface EngineOptions {
  /** Override the protocol timing (e.g. the accelerated preset for tests). */
  timing?: EngineTiming;
}

/** Runtime-agnostic mDNS engine over a {@link DatagramTransport}. */
export class MdnsEngine {
  private readonly transport: DatagramTransport;
  private readonly timing: EngineTiming;
  private readonly browsers = new Set<Browser>();
  private readonly responders = new Set<Responder>();
  private readonly ownAddresses: Set<string>;
  private closed = false;
  private readonly loop: Promise<void>;

  /** Create an engine bound to a multicast datagram transport. */
  constructor(transport: DatagramTransport, options: EngineOptions = {}) {
    this.transport = transport;
    this.timing = options.timing ?? DEFAULT_TIMING;
    this.ownAddresses = new Set(transport.localAddresses());
    this.loop = this.runReceiveLoop();
  }

  /** Receive and dispatch decoded DNS messages until the transport closes. */
  private async runReceiveLoop(): Promise<void> {
    for (;;) {
      let datagram;
      try {
        datagram = await this.transport.receive();
      } catch {
        break;
      }
      if (this.closed || datagram === null) break;

      // Ignore our own multicast echoes.
      if (this.ownAddresses.has(datagram.source.address)) continue;

      let message: DnsMessage;
      try {
        message = decodeMessage(datagram.data);
      } catch {
        // Drop malformed / hostile packets silently.
        continue;
      }

      if (message.header.isResponse) {
        for (const browser of this.browsers) browser.onResponse(message);
        for (const responder of this.responders) responder.onResponse(message);
      } else {
        for (const browser of this.browsers) browser.onQuery(message);
        for (const responder of this.responders) responder.onQuery(message);
      }
    }
  }

  private send = (message: DnsMessage): void => {
    if (this.closed) return;
    void this.transport.send(encodeMessage(message));
  };

  /** Start browsing for a service type. */
  browse(spec: BrowseServiceSpec): MdnsBrowser {
    const browser = new Browser(
      {
        timing: this.timing,
        send: this.send,
        register: (b) => this.browsers.add(b),
        unregister: (b) => this.browsers.delete(b),
      },
      {
        type: spec.type,
        protocol: spec.protocol,
        domain: spec.domain ?? "local",
        subtypes: spec.subtypes,
      },
    );
    return browser;
  }

  /** Advertise a service; resolves once the name is claimed and announced. */
  async advertise(spec: AdvertiseServiceSpec): Promise<MdnsResponder> {
    const responder = new Responder(
      {
        timing: this.timing,
        family: this.transport.family,
        hostname: this.transport.hostname,
        localAddresses: () => this.transport.localAddresses(),
        send: this.send,
        register: (r) => this.responders.add(r),
        unregister: (r) => this.responders.delete(r),
      },
      spec,
    );
    await responder.start();
    return responder;
  }

  /** Close the engine, all browsers/responders and the transport. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const browser of this.browsers) browser.close();
    for (const responder of this.responders) await responder.stop();
    await this.transport.close();
    await this.loop.catch(() => {});
  }
}
