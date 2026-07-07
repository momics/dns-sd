/**
 * Pure, IPC-free mapping logic shared by the Tauri adapter.
 *
 * This module deliberately imports **only** type-level symbols from the shared
 * package and nothing from `@tauri-apps/api`, so it can be unit-tested without a
 * webview or the Tauri runtime. {@link ./index.ts} wires these helpers into the
 * real IPC transport.
 *
 * @module
 */

import type {
  ServiceAnnouncement,
  ServiceEventKind,
  ServiceSink,
  TransportProtocol,
  TxtRecords,
  TxtRecordsInput,
} from "@momics/dns-sd-shared";

/** A TXT value as it crosses the IPC boundary: bare-key, empty, or bytes. */
export type TxtWire = true | null | number[];

/** The `ServiceRecord` emitted by the native layers (camelCase serde). */
export interface ServiceRecordWire {
  name: string;
  fullName: string;
  host: string | null;
  port: number | null;
  serviceType: string;
  protocol: TransportProtocol;
  domain: string;
  subtypes: string[];
  addresses: string[];
  txt: Record<string, TxtWire>;
  isActive: boolean;
  lastSeenMs: number;
}

export interface BrowseServiceMessage {
  browseId: number;
  service: ServiceRecordWire;
}

export interface BrowseStoppedMessage {
  browseId: number;
  reason: string;
}

export type BrowseChannelMessage = BrowseServiceMessage | BrowseStoppedMessage;

export interface BrowseHandleWire {
  browseId: number;
}

export interface AdvertiseHandleWire {
  advertiseId: number;
  name: string;
  fullName: string;
}

/** Decode the wire TXT map into the shared {@link TxtRecords} shape. */
export function decodeTxt(
  txt: Record<string, TxtWire> | undefined,
): TxtRecords {
  const out: TxtRecords = {};
  if (!txt) return out;
  for (const [key, value] of Object.entries(txt)) {
    if (value === true) {
      out[key] = true;
    } else if (value === null) {
      out[key] = null;
    } else {
      out[key] = new Uint8Array(value);
    }
  }
  return out;
}

/** Encode caller-supplied TXT input into the wire form the Rust models accept. */
export function encodeTxt(
  txt: TxtRecordsInput | undefined,
): Record<string, TxtWire> | undefined {
  if (!txt) return undefined;
  const out: Record<string, TxtWire> = {};
  const encoder = new TextEncoder();
  for (const [key, value] of Object.entries(txt)) {
    if (value === true) {
      out[key] = true;
    } else if (value === null) {
      out[key] = null;
    } else if (value instanceof Uint8Array) {
      out[key] = Array.from(value);
    } else {
      // Convenience: plain strings are UTF-8 encoded (RFC 6763 §6.5).
      out[key] = Array.from(encoder.encode(value));
    }
  }
  return out;
}

/** Map a wire record + derived {@link ServiceEventKind} to a {@link ServiceAnnouncement}. */
export function toAnnouncement(
  record: ServiceRecordWire,
  kind: ServiceEventKind,
): ServiceAnnouncement {
  const base = {
    name: record.name,
    fullName: record.fullName,
    serviceType: record.serviceType,
    protocol: record.protocol,
    domain: record.domain,
    subtypes: record.subtypes ?? [],
    txt: decodeTxt(record.txt),
    lastSeenMs: record.lastSeenMs,
  };

  switch (kind) {
    case "found":
      return {
        ...base,
        kind: "found",
        host: null,
        port: null,
        addresses: [],
        isActive: true,
      };
    case "resolved":
      return {
        ...base,
        kind: "resolved",
        host: record.host!,
        port: record.port!,
        addresses: record.addresses ?? [],
        isActive: true,
      };
    case "updated":
      return {
        ...base,
        kind: "updated",
        host: record.host!,
        port: record.port!,
        addresses: record.addresses ?? [],
        isActive: true,
      };
    case "removed":
      return {
        ...base,
        kind: "removed",
        host: record.host,
        port: record.port,
        addresses: record.addresses ?? [],
        isActive: false,
      };
  }
}

/**
 * Build the per-browse channel-message handler that derives the unified
 * {@link ServiceEventKind} (`found` → `resolved` → `updated` → `removed`) from
 * the native layers' `isActive` + host/port signals and feeds
 * {@link ServiceAnnouncement}s into `sink`.
 *
 * Tracks, per discovered instance, whether a `resolved` event has already been
 * emitted; absence means "not yet found".
 */
export function createBrowseMessageHandler(
  sink: ServiceSink,
): (message: BrowseChannelMessage) => void {
  const resolvedByName = new Map<string, boolean>();

  return (message: BrowseChannelMessage) => {
    if (!("service" in message)) return; // browse-stopped; stream owns lifecycle
    const record = message.service;
    const key = record.fullName;

    if (!record.isActive) {
      resolvedByName.delete(key);
      sink(toAnnouncement(record, "removed"));
      return;
    }

    const isResolved = record.host !== null && record.port !== null;

    if (!resolvedByName.has(key)) {
      resolvedByName.set(key, isResolved);
      sink(toAnnouncement(record, "found"));
      if (isResolved) sink(toAnnouncement(record, "resolved"));
      return;
    }

    if (isResolved && resolvedByName.get(key) === false) {
      resolvedByName.set(key, true);
      sink(toAnnouncement(record, "resolved"));
      return;
    }

    // Suppress `updated` for an instance that is still unresolved (host/port
    // null) and was already recorded as unresolved. Emitting `updated` here
    // would violate the cross-backend contract that `updated` guarantees a
    // non-null host and port (see ServiceAnnouncement in @momics/dns-sd-shared).
    if (!isResolved && resolvedByName.get(key) === false) {
      return;
    }

    sink(toAnnouncement(record, "updated"));
  };
}
