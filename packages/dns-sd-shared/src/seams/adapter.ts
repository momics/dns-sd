/**
 * The high-level adapter seam. Platforms that cannot do raw multicast — most
 * importantly iOS and Android (via Tauri) — must delegate discovery and
 * advertising to the operating system's own mDNS resolver (Bonjour
 * `NWBrowser` on Apple platforms, `NsdManager` on Android). On this path the
 * OS performs the mDNS protocol; the adapter's only job is to map OS events to
 * our {@link ServiceAnnouncement} type.
 *
 * @module
 */

import type {
  AdvertiseServiceSpec,
  BrowseServiceSpec,
  ServiceAnnouncement,
} from "../types.ts";

/** A running browse on an adapter. Calling {@link stop} is the "browseStop" op. */
export interface AdapterBrowseHandle {
  /** Stop this browse (maps to the platform's browse-stop call). */
  stop(): Promise<void>;
}

/** A running advertisement on an adapter. Calling {@link stop} is the "advertiseStop" op. */
export interface AdapterAdvertiseHandle {
  /**
   * The final instance name in use, which may differ from the requested name
   * if the OS resolved a conflict by renaming.
   */
  readonly name: string;
  /**
   * The final fully-qualified instance name (e.g. `Instance._http._tcp.local`),
   * as reported by the OS resolver. Kept distinct from {@link name} so the
   * adapter path matches the transport path's `advertise().fullName`.
   */
  readonly fullName: string;
  /** Stop this advertisement (maps to the platform's advertise-stop call). */
  stop(): Promise<void>;
}

/** A callback the adapter invokes for each discovery event from the OS. */
export type ServiceSink = (event: ServiceAnnouncement) => void;

/**
 * A higher-level discovery/advertisement backend backed by an OS resolver.
 *
 * The `browseStart` / `advertiseStart` methods start an operation and return a
 * handle whose `stop()` performs the corresponding `browseStop` /
 * `advertiseStop`. Emitted {@link ServiceAnnouncement} values must already be
 * in our normalized form so the public API is identical to the transport path.
 */
export interface DnsSdAdapter {
  /**
   * Start browsing for the given service type. Each discovery change is
   * delivered to `sink` as a {@link ServiceAnnouncement}.
   */
  browseStart(
    spec: BrowseServiceSpec,
    sink: ServiceSink,
  ): Promise<AdapterBrowseHandle>;

  /** Start advertising the given service. */
  advertiseStart(spec: AdvertiseServiceSpec): Promise<AdapterAdvertiseHandle>;

  /** Tear down the adapter and any OS resources it holds. */
  close(): Promise<void>;
}
