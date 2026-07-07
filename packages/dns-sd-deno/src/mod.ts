/**
 * `@momics/dns-sd-deno` — the Deno runtime package for the standards-compliant
 * DNS-SD (multicast DNS, RFC 6762 + RFC 6763) library.
 *
 * This is a thin adapter: it supplies a real UDP-multicast
 * {@link DatagramTransport} (see {@link DenoTransport}) to the runtime-agnostic
 * engine in `@momics/dns-sd-shared` and re-exports the identical public API
 * (`browse` / `advertise` / `close`) plus all shared types.
 *
 * Deno desktop only: raw UDP multicast needs `--unstable-net` and `--allow-net`
 * (and `--allow-sys` to enumerate local addresses / read the host name).
 *
 * @example Browse
 * ```ts
 * import { browse } from "@momics/dns-sd-deno";
 * for await (const svc of browse({ service: { type: "http", protocol: "tcp" } })) {
 *   console.log(svc.kind, svc.name, svc.addresses);
 * }
 * ```
 *
 * @example Advertise
 * ```ts
 * import { advertise } from "@momics/dns-sd-deno";
 * const handle = await advertise({
 *   service: { name: "My Server", type: "http", protocol: "tcp", port: 8080 },
 * });
 * // ... later
 * await handle.stop();
 * ```
 *
 * @module
 */

import {
  type AdvertiseHandle,
  type AdvertiseOpts,
  type BrowseOpts,
  createDnsSd,
  type DnsSd,
  type EngineOptions,
  type ServiceAnnouncement,
} from "@momics/dns-sd-shared";
import { DenoTransport, type DenoTransportOptions } from "./transport.ts";

// ── Re-export the identical shared public API + types ───────────────────────
export * from "@momics/dns-sd-shared";

// ── Deno-specific surface ───────────────────────────────────────────────────
export { DenoTransport, type DenoTransportOptions } from "./transport.ts";
export { localHostname, localInterfaceAddresses } from "./addresses.ts";

/** Options for {@link createNode}. */
export interface CreateNodeOptions extends EngineOptions {
  /** Options forwarded to the underlying {@link DenoTransport}. */
  transport?: DenoTransportOptions;
}

/**
 * Create a standalone {@link DnsSd} node backed by a fresh {@link DenoTransport}.
 *
 * Each node owns its own socket, so create one per family/interface you want to
 * operate on. Call {@link DnsSd.close} to release the socket.
 */
export function createNode(options: CreateNodeOptions = {}): DnsSd {
  const { transport, ...engine } = options;
  return createDnsSd({
    transport: new DenoTransport(transport),
    ...engine,
  });
}

// ── Top-level convenience API over a lazily-created default node ─────────────
// The default node picks a sensible interface/family (IPv4, any interface).

let defaultNode: DnsSd | null = null;

function getDefaultNode(): DnsSd {
  return (defaultNode ??= createNode());
}

/**
 * Continuously discover service instances over the default node. See
 * {@link DnsSd.browse}.
 */
export function browse(
  opts: BrowseOpts,
): AsyncGenerator<ServiceAnnouncement, void, void> {
  return getDefaultNode().browse(opts);
}

/** Advertise a service over the default node. See {@link DnsSd.advertise}. */
export function advertise(opts: AdvertiseOpts): Promise<AdvertiseHandle> {
  return getDefaultNode().advertise(opts);
}

/**
 * Close the default node and release its socket. A subsequent call to
 * {@link browse} / {@link advertise} lazily creates a new default node.
 */
export async function close(): Promise<void> {
  if (defaultNode) {
    const node = defaultNode;
    defaultNode = null;
    await node.close();
  }
}
