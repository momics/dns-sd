/**
 * `@momics/dns-sd-tauri` — the Tauri v2 guest-js binding.
 *
 * This module implements the shared {@link DnsSdAdapter} seam over Tauri's IPC
 * (the Rust desktop `mdns-sd` implementation and the iOS/Android native OS
 * resolvers) and feeds the result into {@link createDnsSd}. It therefore
 * re-exports the **identical** public API — `browse`, `advertise`, `close` —
 * as the Deno and Node.js runtime packages.
 *
 * On iOS the underlying `NWBrowser` reports discovered endpoints but does not
 * surface their host/addresses on its own; the plugin resolves each instance
 * through `NetService` (Bonjour), so browse events are emitted as `found` and
 * then `resolved` with host/port/addresses. Desktop, iOS and Android all resolve
 * fully. See the package README for the full platform matrix.
 *
 * @module
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import {
  type AdapterAdvertiseHandle,
  type AdapterBrowseHandle,
  type AdvertiseServiceSpec,
  type BrowseServiceSpec,
  createDnsSd,
  type DnsSd,
  type DnsSdAdapter,
  instanceNameLabels,
  type ServiceSink,
} from "@momics/dns-sd-shared";
import {
  type AdvertiseHandleWire,
  type BrowseChannelMessage,
  type BrowseHandleWire,
  createBrowseMessageHandler,
  encodeTxt,
} from "./adapter-core.ts";

/**
 * A {@link DnsSdAdapter} backed by the Tauri `dns-sd` plugin.
 *
 * The native layers report per-instance state changes with an `isActive` flag
 * (and, once resolved, a host/port/addresses). This adapter derives the unified
 * {@link ServiceEventKind} (`found` → `resolved` → `updated` → `removed`) that
 * the shared public API guarantees, tracking per-browse instance state.
 */
class TauriDnsSdAdapter implements DnsSdAdapter {
  browseStart(
    spec: BrowseServiceSpec,
    sink: ServiceSink,
  ): Promise<AdapterBrowseHandle> {
    const channel = new Channel<BrowseChannelMessage>();
    channel.onmessage = createBrowseMessageHandler(sink);

    // The shared engine owns timeout/abort semantics via the browse generator,
    // so the native browse must run continuously (timeoutMs: 0).
    const options = {
      service: {
        type: spec.type,
        protocol: spec.protocol,
        domain: spec.domain,
        subtypes: spec.subtypes ?? [],
      },
      timeoutMs: 0,
    };

    return invoke<BrowseHandleWire>("plugin:dns-sd|browse_start", {
      options,
      channel,
    }).then(({ browseId }) => ({
      async stop() {
        await invoke("plugin:dns-sd|browse_stop", { browseId });
      },
    }));
  }

  advertiseStart(
    spec: AdvertiseServiceSpec,
  ): Promise<AdapterAdvertiseHandle> {
    const service = {
      name: spec.name,
      type: spec.type,
      protocol: spec.protocol,
      port: spec.port,
      host: spec.host,
      domain: spec.domain,
      subtypes: spec.subtypes ?? [],
      txt: encodeTxt(spec.txt) ?? {},
    };

    return invoke<AdvertiseHandleWire>("plugin:dns-sd|advertise_start", {
      options: { service },
    }).then(({ advertiseId, name, fullName }) => {
      const finalName = name ?? spec.name;
      // Prefer the FQN reported by the OS; otherwise derive it from the final
      // instance name so `advertise().fullName` matches the transport path.
      const finalFullName = fullName ??
        instanceNameLabels(
          finalName,
          spec.type,
          spec.protocol,
          spec.domain,
        ).join(".");
      return {
        name: finalName,
        fullName: finalFullName,
        async stop() {
          await invoke("plugin:dns-sd|advertise_stop", { advertiseId });
        },
      };
    });
  }

  close(): Promise<void> {
    // Individual browses/advertisements are torn down via their own handles;
    // there is no global native resource to release.
    return Promise.resolve();
  }
}

const dnsSd: DnsSd = createDnsSd({ adapter: new TauriDnsSdAdapter() });

/**
 * Continuously discover service instances. Identical in shape and semantics to
 * the Deno/Node runtime packages' `browse`.
 */
export const browse: DnsSd["browse"] = (opts) => dnsSd.browse(opts);

/** Advertise a service on the local network. */
export const advertise: DnsSd["advertise"] = (opts) => dnsSd.advertise(opts);

/** Release the underlying adapter and all resources. */
export const close: DnsSd["close"] = () => dnsSd.close();

/** The exported adapter class, for advanced callers building their own `DnsSd`. */
export { TauriDnsSdAdapter };

// ── Re-exported public types (identical across every runtime) ───────────────
export type {
  AdvertiseHandle,
  AdvertiseOpts,
  AdvertiseServiceSpec,
  BrowseOpts,
  BrowseServiceSpec,
  DnsSd,
  ServiceAnnouncement,
  ServiceEventKind,
  TransportProtocol,
  TxtRecordInput,
  TxtRecords,
  TxtRecordsInput,
  TxtValue,
} from "@momics/dns-sd-shared";
