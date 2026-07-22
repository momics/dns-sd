/**
 * `@momics/dns-sd-shared` — the shared, runtime-agnostic foundation for a
 * standards-compliant DNS-SD (multicast DNS, RFC 6762 + RFC 6763) library.
 *
 * This package contains the public API types, the hardened DNS wire codec, the
 * runtime-agnostic mDNS engine, and the two backend seams
 * ({@link DatagramTransport} and {@link DnsSdAdapter}) that per-runtime packages
 * (Deno, Node.js, Tauri) plug into. It performs no I/O itself.
 *
 * @module
 */

// ── Public API surface ─────────────────────────────────────────────────────
export {
  type AdapterBackend,
  createDnsSd,
  type DnsSdBackend,
  dnsSdOverAdapter,
  dnsSdOverTransport,
  type TransportBackend,
} from "./api.ts";

// ── Public types ────────────────────────────────────────────────────────────
export type {
  AdvertiseHandle,
  AdvertiseOpts,
  AdvertiseServiceSpec,
  BrowseOpts,
  BrowseServiceSpec,
  DnsSd,
  ServiceAnnouncement,
  ServiceAnnouncementBase,
  ServiceEventKind,
  ServiceFound,
  ServiceRemoved,
  ServiceResolved,
  ServiceUpdated,
  TransportProtocol,
  TxtRecordInput,
  TxtRecords,
  TxtRecordsInput,
  TxtValue,
} from "./types.ts";

// ── Backend seams ─────────────────────────────────────────────────────────────
export {
  type DatagramSource,
  type DatagramTransport,
  type IpFamily,
  MDNS_IPV4,
  MDNS_IPV6,
  MDNS_PORT,
  type ReceivedDatagram,
} from "./seams/transport.ts";
export {
  type AdapterAdvertiseHandle,
  type AdapterBrowseHandle,
  type DnsSdAdapter,
  type ServiceSink,
} from "./seams/adapter.ts";

// ── Engine (for runtime packages that need to tune timing) ──────────────────
export {
  DEFAULT_TIMING,
  type EngineTiming,
  FAST_TIMING,
  TTL_HOST,
  TTL_SHARED,
} from "./engine/constants.ts";
export {
  type EngineOptions,
  type MdnsBrowser,
  MdnsEngine,
  type MdnsResponder,
} from "./engine/engine.ts";

// ── Naming + TXT helpers ────────────────────────────────────────────────────
export {
  DEFAULT_DOMAIN,
  instanceNameLabels,
  nameKey,
  namesEqual,
  type ParsedServiceName,
  parseServiceName,
  SERVICE_TYPE_ENUMERATION,
  serviceTypeLabels,
  subtypeServiceLabels,
} from "./naming.ts";
export { encodeTxtInput, txtFromAttributes, txtValueToString } from "./txt.ts";
export type { TxtAttributes } from "./wire/types.ts";

// ── Self-echo suppression (shared by the UDP transports) ────────────────────
export {
  DEFAULT_ECHO_MAX_ENTRIES,
  DEFAULT_ECHO_TTL_MS,
  EchoSuppressor,
  type EchoSuppressorOptions,
  fingerprint,
} from "./echo.ts";
