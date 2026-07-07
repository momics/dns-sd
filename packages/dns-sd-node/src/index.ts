/**
 * `@momics/dns-sd-node` — the Node.js runtime package for the `@momics/dns-sd`
 * family. It supplies a UDP-multicast {@link NodeTransport} (via `node:dgram`)
 * to the shared, runtime-agnostic mDNS engine and re-exports the identical
 * public API.
 *
 * @example Browse
 * ```ts
 * import { browse } from "@momics/dns-sd-node";
 * for await (const svc of browse({ service: { type: "http", protocol: "tcp" } })) {
 *   console.log(svc.kind, svc.name, svc.addresses);
 * }
 * ```
 *
 * @example Advertise
 * ```ts
 * import { advertise, close } from "@momics/dns-sd-node";
 * const handle = await advertise({
 *   service: { type: "http", protocol: "tcp", name: "My Server", port: 8080 },
 * });
 * // …later…
 * await handle.stop();
 * await close();
 * ```
 *
 * @module
 */

import { createDnsSd } from "@momics/dns-sd-shared";
import type {
  AdvertiseHandle,
  AdvertiseOpts,
  BrowseOpts,
  DnsSd,
  EngineTiming,
  ServiceAnnouncement,
} from "@momics/dns-sd-shared";
import { NodeTransport, type NodeTransportOptions } from "./transport.ts";

export { NodeTransport, type NodeTransportOptions } from "./transport.ts";

// Re-export the entire shared public API so callers depend only on this package.
export * from "@momics/dns-sd-shared";

/** Options for {@link createNodeDnsSd}: transport tuning plus engine timing. */
export interface NodeDnsSdOptions extends NodeTransportOptions {
  /** Override the engine's protocol timing (RFC 6762 defaults otherwise). */
  timing?: EngineTiming;
}

/**
 * Build a {@link DnsSd} backed by a fresh {@link NodeTransport}. This is the
 * primary entry point when you want to manage the transport's lifetime
 * yourself; the module-level {@link browse} / {@link advertise} / {@link close}
 * helpers wrap a lazily-created default instance.
 */
export function createNodeDnsSd(options: NodeDnsSdOptions = {}): DnsSd {
  const { timing, ...transportOptions } = options;
  const transport = new NodeTransport(transportOptions);
  return timing
    ? createDnsSd({ transport, timing })
    : createDnsSd({ transport });
}

let defaultInstance: DnsSd | null = null;

function defaultDnsSd(): DnsSd {
  if (!defaultInstance) defaultInstance = createNodeDnsSd();
  return defaultInstance;
}

/**
 * Continuously discover service instances using the default Node transport.
 * See {@link BrowseOpts}. Stop by `break`-ing the loop, an `AbortSignal`, or
 * `timeoutMs`.
 */
export function browse(
  opts: BrowseOpts,
): AsyncGenerator<ServiceAnnouncement, void, void> {
  return defaultDnsSd().browse(opts);
}

/** Advertise a service on the local network using the default Node transport. */
export function advertise(opts: AdvertiseOpts): Promise<AdvertiseHandle> {
  return defaultDnsSd().advertise(opts);
}

/**
 * Close the default instance and release its socket. Safe to call when no
 * default instance was ever created. A subsequent {@link browse} /
 * {@link advertise} lazily creates a new one.
 */
export async function close(): Promise<void> {
  if (!defaultInstance) return;
  const instance = defaultInstance;
  defaultInstance = null;
  await instance.close();
}
