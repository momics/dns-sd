/**
 * Loopback cross-runtime interop test.
 *
 * `integration/cross-runtime.test.mjs` proves Node↔Deno wire compatibility over
 * real UDP multicast, but it is gated behind `DNS_SD_NETWORK_TESTS=1` and never
 * runs in CI, so nothing automatically proves the engine speaks the shared wire
 * format end-to-end on every push. This test closes that gap **in-process**: it
 * drives a full advertise→browse exchange over the {@link VirtualBus} loopback
 * transport (no sockets, no multicast) and additionally decodes the raw bytes
 * that actually crossed the bus, asserting the on-the-wire records — not just the
 * resolved object.
 *
 * Because the whole shared suite runs unchanged under BOTH Deno and Node
 * (`deno task test` / `npm run test:node`), CI exercises this exact exchange and
 * codec under each runtime, which is the automated proof that both runtimes
 * encode and decode an identical wire format. The real-multicast interop suite
 * stays manual/on-demand.
 *
 * The service shape here mirrors the manual interop scripts
 * (`integration/scripts/*`) — TXT `{ path: "/api", secure: true, empty: null }`
 * — so the loopback and real-multicast proofs assert the same thing.
 *
 * @module
 */

import { assert, assertEquals, test } from "../src/testing/harness.ts";
import { createDnsSd } from "../src/index.ts";
import type { DnsSd, ServiceResolved } from "../src/types.ts";
import { FAST_TIMING } from "../src/engine/constants.ts";
import { VirtualBus } from "../src/testing/loopback.ts";
import {
  decodeMessage,
  isA,
  isPTR,
  isSRV,
  isTXT,
  type ResourceRecord,
} from "../src/wire/index.ts";

const SERVICE = {
  type: "http",
  protocol: "tcp",
  name: "Interop Web",
  port: 8080,
  txt: { path: "/api", secure: true, empty: null },
} as const;

const INSTANCE = "Interop Web._http._tcp.local";

async function firstResolved(
  node: DnsSd,
  timeoutMs = 5000,
): Promise<ServiceResolved> {
  const gen = node.browse({ service: { type: "http", protocol: "tcp" } });
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => deadline.reject(new Error("timed out waiting for resolved event")),
    timeoutMs,
  );
  try {
    for (;;) {
      const next = await Promise.race([gen.next(), deadline.promise]);
      if (next.done) throw new Error("browse ended before resolving");
      if (next.value.kind === "resolved") return next.value;
    }
  } finally {
    clearTimeout(timer);
    await gen.return();
  }
}

test("interop (loopback): advertise is resolved AND the wire records match", async () => {
  const bus = new VirtualBus();
  const advertiser = createDnsSd({
    transport: bus.createTransport({ hostname: "server.local" }),
    timing: FAST_TIMING,
  });
  const browser = createDnsSd({
    transport: bus.createTransport(),
    timing: FAST_TIMING,
  });
  // A passive third node on the same bus captures every datagram so we can
  // decode the actual bytes on the wire (not just the resolved object).
  const sniffer = bus.createTransport();

  // Collect answer records off the bus until we have seen the advertisement's
  // PTR + SRV + TXT + A, or a deadline elapses.
  const sniffed: ResourceRecord[] = [];
  const sniff = (async () => {
    const stopAt = Date.now() + 5000;
    while (Date.now() < stopAt) {
      const datagram = await sniffer.receive();
      if (datagram === null) return;
      let message;
      try {
        message = decodeMessage(datagram.data);
      } catch {
        continue; // ignore anything that isn't a well-formed DNS message
      }
      sniffed.push(...message.answers, ...message.additionals);
      const haveSrv = sniffed.some((r) =>
        isSRV(r) && r.name.join(".") === INSTANCE
      );
      const haveTxt = sniffed.some((r) =>
        isTXT(r) && r.name.join(".") === INSTANCE
      );
      if (haveSrv && haveTxt) return;
    }
  })();

  try {
    const handle = await advertiser.advertise({ service: SERVICE });
    assertEquals(handle.fullName, INSTANCE);

    const resolved = await firstResolved(browser);
    // ── Resolved-object assertions (mirror the manual interop scripts) ──────
    assertEquals(resolved.name, "Interop Web");
    assertEquals(resolved.serviceType, "http");
    assertEquals(resolved.port, 8080);
    assert(resolved.host !== null, "host should be resolved");
    assert(resolved.addresses.length > 0, "expected at least one address");
    assertEquals(
      new TextDecoder().decode(resolved.txt.path as Uint8Array),
      "/api",
    );
    assertEquals(resolved.txt.secure, true);
    assertEquals(resolved.txt.empty, null);

    // ── Wire-level assertions (decode the bytes that crossed the bus) ───────
    await sniff;
    sniffer.close();

    const ptr = sniffed.find(
      (r) => isPTR(r) && r.data.name.join(".") === INSTANCE,
    );
    assert(
      ptr !== undefined,
      "expected a PTR pointing at the instance on the wire",
    );

    const srv = sniffed.find((r) => isSRV(r) && r.name.join(".") === INSTANCE);
    assert(srv !== undefined && isSRV(srv), "expected an SRV for the instance");
    assertEquals(srv.data.port, 8080);
    assertEquals(srv.data.target.join("."), "server.local");

    const txt = sniffed.find((r) => isTXT(r) && r.name.join(".") === INSTANCE);
    assert(txt !== undefined && isTXT(txt), "expected a TXT for the instance");
    assertEquals(
      new TextDecoder().decode(txt.data.attributes.path as Uint8Array),
      "/api",
    );
    assertEquals(txt.data.attributes.secure, true);
    assertEquals(txt.data.attributes.empty, null);

    const a = sniffed.find((r) =>
      isA(r) && r.name.join(".") === "server.local"
    );
    assert(a !== undefined, "expected an A record for the advertised host");
  } finally {
    sniffer.close();
    await advertiser.close();
    await browser.close();
  }
});
