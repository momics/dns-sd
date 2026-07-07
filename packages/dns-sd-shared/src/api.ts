/**
 * The runtime-agnostic entry point. A runtime package injects its backend —
 * either a low-level {@link DatagramTransport} (Deno/Node) or a high-level
 * {@link DnsSdAdapter} (Tauri/native) — and gets back an identical {@link DnsSd}
 * with `browse` / `advertise`.
 *
 * @module
 */

import type {
  AdvertiseHandle,
  AdvertiseOpts,
  BrowseOpts,
  DnsSd,
  ServiceAnnouncement,
} from "./types.ts";
import type { DatagramTransport } from "./seams/transport.ts";
import type { DnsSdAdapter } from "./seams/adapter.ts";
import { type EngineOptions, MdnsEngine } from "./engine/engine.ts";
import { FastFIFO } from "./fast_fifo.ts";

/** Backend that drives mDNS over a raw UDP multicast transport (Deno/Node). */
export interface TransportBackend extends EngineOptions {
  transport: DatagramTransport;
}

/** Backend that delegates to an OS resolver via an adapter (Tauri/native). */
export interface AdapterBackend {
  adapter: DnsSdAdapter;
}

/** A backend supplied to {@link createDnsSd}. */
export type DnsSdBackend = TransportBackend | AdapterBackend;

/**
 * Build a {@link DnsSd} from a backend. Supply either `{ transport }` (the
 * engine drives real mDNS) or `{ adapter }` (an OS resolver drives it).
 */
export function createDnsSd(backend: DnsSdBackend): DnsSd {
  if ("transport" in backend) {
    const { transport, ...options } = backend;
    return dnsSdOverTransport(transport, options);
  }
  return dnsSdOverAdapter(backend.adapter);
}

/** Build a {@link DnsSd} that drives the shared engine over a transport. */
export function dnsSdOverTransport(
  transport: DatagramTransport,
  options: EngineOptions = {},
): DnsSd {
  const engine = new MdnsEngine(transport, options);

  return {
    browse(opts: BrowseOpts): AsyncGenerator<ServiceAnnouncement, void, void> {
      const browser = engine.browse(opts.service);
      return withStop(
        browser.events(),
        () => browser.close(),
        opts.timeoutMs,
        opts.signal,
      );
    },

    async advertise(opts: AdvertiseOpts): Promise<AdvertiseHandle> {
      const responder = await engine.advertise(opts.service);
      return makeAdvertiseHandle(
        () => responder.name,
        () => responder.fullName,
        () => responder.stop(),
        opts.signal,
      );
    },

    close(): Promise<void> {
      return engine.close();
    },
  };
}

/** Build a {@link DnsSd} that delegates to an OS resolver adapter. */
export function dnsSdOverAdapter(adapter: DnsSdAdapter): DnsSd {
  return {
    browse(opts: BrowseOpts): AsyncGenerator<ServiceAnnouncement, void, void> {
      const queue = new FastFIFO<ServiceAnnouncement>();
      const handlePromise = adapter.browseStart(
        opts.service,
        (event) => queue.push(event),
      );
      // Surface a browse-start failure to the consumer instead of swallowing
      // it, so callers observe it just like the transport path. Once the queue
      // is stopped/closed, `fail` is a no-op, so a late rejection is ignored.
      handlePromise.catch((err) => queue.fail(err));
      let stopped = false;
      return withStop(
        queue,
        () => {
          if (stopped) return;
          stopped = true;
          queue.close();
          void handlePromise.then((h) => h.stop(), () => {});
        },
        opts.timeoutMs,
        opts.signal,
      );
    },

    async advertise(opts: AdvertiseOpts): Promise<AdvertiseHandle> {
      const handle = await adapter.advertiseStart(opts.service);
      return makeAdvertiseHandle(
        () => handle.name,
        () => handle.fullName,
        () => handle.stop(),
        opts.signal,
      );
    },

    close(): Promise<void> {
      return adapter.close();
    },
  };
}

/**
 * Wrap an async iterable so it stops (invoking `stop`) when the optional
 * timeout elapses or the optional signal aborts, and always cleans up when the
 * consumer stops iterating.
 */
async function* withStop<T>(
  source: AsyncIterable<T>,
  stop: () => void,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<T, void, void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => stop();

  if (signal) {
    if (signal.aborted) stop();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timer = setTimeout(stop, timeoutMs);
  }

  try {
    for await (const item of source) {
      yield item;
    }
  } finally {
    stop();
    if (timer !== undefined) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function makeAdvertiseHandle(
  name: () => string,
  fullName: () => string,
  stop: () => Promise<void>,
  signal: AbortSignal | undefined,
): AdvertiseHandle {
  let stopped: Promise<void> | null = null;
  const doStop = (): Promise<void> => {
    if (!stopped) stopped = stop();
    return stopped;
  };

  if (signal) {
    if (signal.aborted) void doStop();
    else signal.addEventListener("abort", () => void doStop(), { once: true });
  }

  return {
    get name() {
      return name();
    },
    get fullName() {
      return fullName();
    },
    stop: doStop,
    [Symbol.asyncDispose]: doStop,
  };
}
