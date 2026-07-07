/**
 * Hermetic unit tests for the Tauri adapter's pure mapping logic.
 *
 * These exercise the {@link createBrowseMessageHandler} kind-derivation state
 * machine and the TXT (en/de)coders without touching Tauri IPC or a webview, so
 * they run anywhere `deno test` runs. The live IPC path (Rust desktop, iOS,
 * Android) is covered by the Rust integration tests and the example app.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import type { ServiceAnnouncement } from "@momics/dns-sd-shared";
import {
  createBrowseMessageHandler,
  decodeTxt,
  encodeTxt,
  type ServiceRecordWire,
  toAnnouncement,
} from "./adapter-core.ts";

function record(
  partial: Partial<ServiceRecordWire> & { fullName: string },
): ServiceRecordWire {
  return {
    name: partial.name ?? "Instance",
    fullName: partial.fullName,
    host: partial.host ?? null,
    port: partial.port ?? null,
    serviceType: partial.serviceType ?? "http",
    protocol: partial.protocol ?? "tcp",
    domain: partial.domain ?? "local",
    subtypes: partial.subtypes ?? [],
    addresses: partial.addresses ?? [],
    txt: partial.txt ?? {},
    isActive: partial.isActive ?? true,
    lastSeenMs: partial.lastSeenMs ?? 0,
  };
}

function collect(): {
  sink: (e: ServiceAnnouncement) => void;
  events: ServiceAnnouncement[];
} {
  const events: ServiceAnnouncement[] = [];
  return { events, sink: (e) => events.push(e) };
}

Deno.test("browse handler: unresolved-then-resolved emits found then resolved then updated", () => {
  const { sink, events } = collect();
  const handler = createBrowseMessageHandler(sink);
  const fullName = "Instance._http._tcp.local.";

  // 1) First sighting without host/port → found only.
  handler({ browseId: 1, service: record({ fullName }) });
  // 2) Now resolved → resolved.
  handler({
    browseId: 1,
    service: record({ fullName, host: "host.local", port: 80 }),
  });
  // 3) Another resolved update → updated.
  handler({
    browseId: 1,
    service: record({ fullName, host: "host.local", port: 80 }),
  });

  assertEquals(events.map((e) => e.kind), ["found", "resolved", "updated"]);
});

Deno.test("browse handler: first sighting already resolved emits found then resolved", () => {
  const events: ServiceAnnouncement[] = [];
  const handler = createBrowseMessageHandler((e) => events.push(e));
  const fullName = "A._http._tcp.local.";

  handler({
    browseId: 1,
    service: record({ fullName, host: "h.local", port: 8080 }),
  });

  assertEquals(events.map((e) => e.kind), ["found", "resolved"]);
});

Deno.test("browse handler: inactive emits removed and resets state", () => {
  const events: ServiceAnnouncement[] = [];
  const handler = createBrowseMessageHandler((e) => events.push(e));
  const fullName = "B._http._tcp.local.";

  handler({
    browseId: 1,
    service: record({ fullName, host: "h.local", port: 80 }),
  });
  handler({
    browseId: 1,
    service: record({ fullName, isActive: false }),
  });
  // After removal, a fresh sighting should be `found` again.
  handler({ browseId: 1, service: record({ fullName }) });

  assertEquals(
    events.map((e) => e.kind),
    ["found", "resolved", "removed", "found"],
  );
  const removed = events[2]!;
  assertEquals(removed.isActive, false);
});

Deno.test("browse handler: stopped messages are ignored", () => {
  const events: ServiceAnnouncement[] = [];
  const handler = createBrowseMessageHandler((e) => events.push(e));
  handler({ browseId: 1, reason: "timeout" });
  assertEquals(events.length, 0);
});

Deno.test("decodeTxt: preserves the three TXT states", () => {
  const decoded = decodeTxt({
    flag: true,
    empty: null,
    bytes: [104, 105],
  });
  assertEquals(decoded.flag, true);
  assertEquals(decoded.empty, null);
  assertEquals(decoded.bytes, new Uint8Array([104, 105]));
});

Deno.test("encodeTxt: maps true/null/bytes/string to the wire form", () => {
  const encoded = encodeTxt({
    flag: true,
    empty: null,
    raw: new Uint8Array([1, 2, 3]),
    str: "hi",
  });
  assertEquals(encoded, {
    flag: true,
    empty: null,
    raw: [1, 2, 3],
    str: [104, 105],
  });
});

Deno.test("toAnnouncement: copies all fields and decodes txt", () => {
  const ann = toAnnouncement(
    record({
      fullName: "C._http._tcp.local.",
      host: "h.local",
      port: 5000,
      addresses: ["10.0.0.1"],
      subtypes: ["printer"],
      txt: { path: [47] },
    }),
    "resolved",
  );
  assertEquals(ann.kind, "resolved");
  assertEquals(ann.host, "h.local");
  assertEquals(ann.port, 5000);
  assertEquals(ann.addresses, ["10.0.0.1"]);
  assertEquals(ann.subtypes, ["printer"]);
  assertEquals(ann.txt.path, new Uint8Array([47]));
});
