/**
 * End-to-end browse ↔ advertise tests over the in-memory loopback transport,
 * and the shared conformance suite run against the same loopback harness.
 *
 * @module
 */

import { assert, assertEquals, test } from "../src/testing/harness.ts";
import { createDnsSd } from "../src/index.ts";
import type { DnsSd, ServiceAnnouncement } from "../src/types.ts";
import { FAST_TIMING } from "../src/engine/constants.ts";
import { VirtualBus } from "../src/testing/loopback.ts";
import {
  conformanceCases,
  type ConformanceHarness,
} from "../src/testing/conformance.ts";

/** Build a loopback-backed conformance harness on a fresh virtual bus. */
function loopbackHarness(): ConformanceHarness {
  const bus = new VirtualBus();
  const nodes: DnsSd[] = [];
  return {
    createNode(): DnsSd {
      const node = createDnsSd({
        transport: bus.createTransport(),
        timing: FAST_TIMING,
      });
      nodes.push(node);
      return node;
    },
    async cleanup(): Promise<void> {
      for (const node of nodes) await node.close();
    },
  };
}

async function collectResolved(
  gen: AsyncGenerator<ServiceAnnouncement, void, void>,
  timeoutMs = 5000,
): Promise<ServiceAnnouncement> {
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => deadline.reject(new Error("timed out waiting for resolved event")),
    timeoutMs,
  );
  try {
    for (;;) {
      const next = await Promise.race([gen.next(), deadline.promise]);
      if (next.done) throw new Error("generator ended before resolving");
      if (next.value.kind === "resolved") return next.value;
    }
  } finally {
    clearTimeout(timer);
    await gen.return();
  }
}

test("e2e: advertise is discovered and fully resolved over loopback", async () => {
  const bus = new VirtualBus();
  const advertiser = createDnsSd({
    transport: bus.createTransport({ hostname: "server.local" }),
    timing: FAST_TIMING,
  });
  const browser = createDnsSd({
    transport: bus.createTransport(),
    timing: FAST_TIMING,
  });
  try {
    await advertiser.advertise({
      service: {
        type: "http",
        protocol: "tcp",
        name: "Web Server",
        port: 8080,
        txt: { path: "/", version: "1.0" },
      },
    });
    const resolved = await collectResolved(
      browser.browse({ service: { type: "http", protocol: "tcp" } }),
    );
    assertEquals(resolved.name, "Web Server");
    assertEquals(resolved.port, 8080);
    assertEquals(resolved.serviceType, "http");
    assert(resolved.host !== null, "host should be resolved");
    assert(resolved.addresses.length > 0, "addresses should be resolved");
    assertEquals(
      new TextDecoder().decode(resolved.txt.path as Uint8Array),
      "/",
    );
  } finally {
    await advertiser.close();
    await browser.close();
  }
});

test("e2e: multiple service instances are all discovered", async () => {
  const bus = new VirtualBus();
  const a = createDnsSd({
    transport: bus.createTransport(),
    timing: FAST_TIMING,
  });
  const b = createDnsSd({
    transport: bus.createTransport(),
    timing: FAST_TIMING,
  });
  const browser = createDnsSd({
    transport: bus.createTransport(),
    timing: FAST_TIMING,
  });
  try {
    await a.advertise({
      service: { type: "http", protocol: "tcp", name: "Alpha", port: 1 },
    });
    await b.advertise({
      service: { type: "http", protocol: "tcp", name: "Beta", port: 2 },
    });
    const names = new Set<string>();
    const gen = browser.browse({ service: { type: "http", protocol: "tcp" } });
    const deadline = Promise.withResolvers<never>();
    const timer = setTimeout(() => deadline.reject(new Error("timeout")), 5000);
    try {
      for (;;) {
        const next = await Promise.race([gen.next(), deadline.promise]);
        if (next.done) break;
        if (next.value.kind === "resolved") names.add(next.value.name);
        if (names.size >= 2) break;
      }
    } finally {
      clearTimeout(timer);
      await gen.return();
    }
    assert(names.has("Alpha") && names.has("Beta"), "both instances resolved");
  } finally {
    await a.close();
    await b.close();
    await browser.close();
  }
});

// Run the shared conformance suite against the loopback harness.
for (const c of conformanceCases()) {
  test(`conformance: ${c.name}`, async () => {
    const harness = loopbackHarness();
    try {
      await c.run(harness);
    } finally {
      await harness.cleanup();
    }
  });
}
