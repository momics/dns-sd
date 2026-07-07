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
 * A single discovery event for a service instance.
 *
 * The same instance is reported multiple times over its lifetime as it is
 * discovered (`found`), resolved (`resolved`), changed (`updated`) and finally
 * removed (`removed`).
 */
export interface ServiceAnnouncement {
  /** What this event represents. */
  kind: ServiceEventKind;
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
  /** The target host name (from the SRV record), or `null` if unresolved. */
  host: string | null;
  /** The port (from the SRV record), or `null` if unresolved. */
  port: number | null;
  /** Resolved IP addresses (IPv4 and/or IPv6). Empty until resolved. */
  addresses: string[];
  /** The instance's TXT attributes. */
  txt: TxtRecords;
  /** `false` once the instance has gone away (`kind === "removed"`). */
  isActive: boolean;
  /** Wall-clock time (ms since epoch) this event was produced. */
  lastSeenMs: number;
}

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
