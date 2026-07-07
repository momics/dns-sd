/**
 * The public, runtime-independent types for the DNS-SD library. Every runtime
 * package (Deno, Node, Tauri) re-exports {@link browse} / {@link advertise}
 * built on exactly these types.
 *
 * @module
 */

/** The transport protocol a service runs over. */
export type TransportProtocol = "tcp" | "udp";

/**
 * A TXT attribute value as returned to callers (RFC 6763 §6):
 * - `true`  — the key is present with no value (bare key).
 * - `null`  — the key is present with an empty value (`key=`).
 * - bytes   — the key has a binary value.
 */
export type TxtValue = Uint8Array | true | null;

/** Decoded TXT records, in the form exposed to callers. */
export type TxtRecords = Record<string, TxtValue>;

/**
 * A TXT attribute value accepted from callers when advertising. In addition to
 * the decoded forms, plain strings are accepted for convenience and encoded as
 * UTF-8.
 */
export type TxtRecordInput = string | Uint8Array | true | null;

/** TXT records supplied when advertising. */
export type TxtRecordsInput = Record<string, TxtRecordInput>;

/** The kind of change an {@link ServiceAnnouncement} represents. */
export type ServiceEventKind =
  /** A matching service instance was discovered (may not be resolved yet). */
  | "found"
  /** The instance's host, port and addresses are now known. */
  | "resolved"
  /** A previously resolved instance changed (e.g. TXT or address update). */
  | "updated"
  /** The instance went away (goodbye packet or cache expiry). */
  | "removed";

/**
 * The fields common to every {@link ServiceAnnouncement} variant, independent of
 * its {@link ServiceEventKind}. The lifecycle-dependent fields (`kind`, `host`,
 * `port`, `addresses`, `isActive`) are refined by each variant below.
 */
export interface ServiceAnnouncementBase {
  /** The service instance name, e.g. `"My Web Server"`. */
  name: string;
  /** The fully-qualified instance name, e.g. `"My Web Server._http._tcp.local"`. */
  fullName: string;
  /** The service type without the leading underscore, e.g. `"http"`. */
  serviceType: string;
  /** The transport protocol the service runs over. */
  protocol: TransportProtocol;
  /** The domain, e.g. `"local"`. */
  domain: string;
  /** Any DNS-SD subtypes advertised for this instance. */
  subtypes: string[];
  /** The instance's TXT attributes. */
  txt: TxtRecords;
  /** Wall-clock time (ms since epoch) this event was produced. */
  lastSeenMs: number;
}

/**
 * A matching instance was discovered but its `SRV` record has not been resolved
 * yet, so its host/port are unknown.
 */
export interface ServiceFound extends ServiceAnnouncementBase {
  kind: "found";
  /** Always `null` until the instance is resolved. */
  host: null;
  /** Always `null` until the instance is resolved. */
  port: null;
  /** Always empty until the instance is resolved. */
  addresses: [];
  /** Discovered instances are active. */
  isActive: true;
}

/**
 * The instance is now resolved. Per the cross-backend contract, `host` and
 * `port` are **guaranteed** non-null; `addresses` is best-effort (see
 * {@link ServiceAnnouncement}).
 */
export interface ServiceResolved extends ServiceAnnouncementBase {
  kind: "resolved";
  /** The target host name (from the `SRV` record). Guaranteed non-null. */
  host: string;
  /** The port (from the `SRV` record). Guaranteed non-null. */
  port: number;
  /** Resolved IP addresses (IPv4 and/or IPv6). Best-effort; may be empty. */
  addresses: string[];
  /** Resolved instances are active. */
  isActive: true;
}

/**
 * A previously resolved instance changed (e.g. a TXT or address update). Carries
 * the same non-null host/port guarantee as {@link ServiceResolved}.
 */
export interface ServiceUpdated extends ServiceAnnouncementBase {
  kind: "updated";
  /** The target host name (from the `SRV` record). Guaranteed non-null. */
  host: string;
  /** The port (from the `SRV` record). Guaranteed non-null. */
  port: number;
  /** Resolved IP addresses (IPv4 and/or IPv6). Best-effort; may be empty. */
  addresses: string[];
  /** Updated instances are still active. */
  isActive: true;
}

/**
 * The instance went away (goodbye packet or cache expiry). This is a teardown
 * event, so `host`/`port` are informational and may be `null`.
 */
export interface ServiceRemoved extends ServiceAnnouncementBase {
  kind: "removed";
  /** The last known host name, or `null` if it was never resolved. */
  host: string | null;
  /** The last known port, or `null` if it was never resolved. */
  port: number | null;
  /** The last known IP addresses; may be empty. */
  addresses: string[];
  /** Removed instances are no longer active. */
  isActive: false;
}

/**
 * A single discovery event for a service instance, modelled as a discriminated
 * union keyed on {@link ServiceEventKind}. Narrow on `kind` to access the
 * lifecycle-dependent fields with precise types.
 *
 * The same instance is reported multiple times over its lifetime as it is
 * discovered (`found`), resolved (`resolved`), changed (`updated`) and finally
 * removed (`removed`).
 *
 * ## Cross-backend contract
 *
 * This contract is uniform across every backend (the pure {@link browse} engine,
 * the Node transport, and the Tauri OS-resolver adapter):
 *
 * - A `resolved` or `updated` announcement **guarantees** non-null `host` and
 *   `port`. Consumers may rely on connecting to `host:port` without a null check
 *   after narrowing on `kind`.
 * - `addresses` is **best-effort**: it MAY be empty even on a `resolved` /
 *   `updated` event. Some backends (notably the OS resolver behind the Tauri
 *   adapter) can legitimately deliver `host` + `port` before — or without ever —
 *   surfacing raw IP addresses. Do not treat an empty `addresses` array as
 *   "unresolved".
 * - A `found` announcement always has `host: null`, `port: null` and an empty
 *   `addresses` array; the instance is known to exist but is not yet resolved.
 */
export type ServiceAnnouncement =
  | ServiceFound
  | ServiceResolved
  | ServiceUpdated
  | ServiceRemoved;

/** Identifies the kind of service to browse for. */
export interface BrowseServiceSpec {
  /** Service type without the leading underscore, e.g. `"http"`. */
  type: string;
  /** The transport protocol the service uses. */
  protocol: TransportProtocol;
  /** Optional domain (defaults to `"local"`). */
  domain?: string;
  /** Optional DNS-SD subtypes to constrain the browse to. */
  subtypes?: string[];
}

/** Options for {@link browse}. */
export interface BrowseOpts {
  /** The service type to browse for. */
  service: BrowseServiceSpec;
  /**
   * Optional timeout in milliseconds after which the browse generator ends.
   * Omit or set to `0` for a continuous, never-ending browse.
   */
  timeoutMs?: number;
  /** Optional abort signal to stop the browse early. */
  signal?: AbortSignal;
}

/** Describes a service to advertise. */
export interface AdvertiseServiceSpec {
  /** The instance name, e.g. `"My Web Server"`. */
  name: string;
  /** Service type without the leading underscore, e.g. `"http"`. */
  type: string;
  /** The transport protocol the service uses. */
  protocol: TransportProtocol;
  /** The port the service listens on. */
  port: number;
  /** Optional host name to advertise (e.g. `"my-device.local"`). Auto-derived if omitted. */
  host?: string;
  /** Optional domain (defaults to `"local"`). */
  domain?: string;
  /** Optional DNS-SD subtypes to register for this instance. */
  subtypes?: string[];
  /** Optional TXT attributes. */
  txt?: TxtRecordsInput;
}

/** Options for {@link advertise}. */
export interface AdvertiseOpts {
  /** The service to advertise. */
  service: AdvertiseServiceSpec;
  /** Optional abort signal that stops (and sends a goodbye for) the advertisement. */
  signal?: AbortSignal;
}

/** A handle to a running advertisement. */
export interface AdvertiseHandle {
  /**
   * The final instance name in use. This may differ from the requested name if
   * a conflict was detected and the name was automatically suffixed.
   */
  readonly name: string;
  /** The final fully-qualified instance name. */
  readonly fullName: string;
  /** Stop advertising, sending a goodbye packet so peers remove the service promptly. */
  stop(): Promise<void>;
  /** Async-dispose alias for {@link stop}. */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * The public DNS-SD surface. A runtime package obtains one via
 * `createDnsSd(...)` and typically re-exports its `browse` / `advertise`
 * methods directly.
 */
export interface DnsSd {
  /**
   * Continuously discover service instances. The returned generator yields a
   * {@link ServiceAnnouncement} per change until the browse is stopped (via the
   * options' `signal`, the `timeoutMs`, or by returning from the loop).
   */
  browse(opts: BrowseOpts): AsyncGenerator<ServiceAnnouncement, void, void>;
  /** Advertise a service on the local network. */
  advertise(opts: AdvertiseOpts): Promise<AdvertiseHandle>;
  /** Release the underlying backend (transport or adapter) and all resources. */
  close(): Promise<void>;
}
