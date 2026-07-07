/**
 * Real-network conformance: run the shared conformance suite against real
 * {@link DenoTransport} sockets.
 *
 * These tests exercise genuine UDP multicast, so they are **gated** behind the
 * `DNS_SD_NETWORK_TESTS=1` environment variable. Many CI runners (and some
 * corporate networks) block multicast routing, which would make these hang or
 * fail through no fault of the code. Run them locally / in an integration
 * environment with:
 *
 *   DNS_SD_NETWORK_TESTS=1 deno test --unstable-net --allow-net --allow-sys
 *
 * ── How multiple nodes coexist on one host ──
 * The shared engine ignores datagrams whose source address is in
 * `transport.localAddresses()`. On one host every node shares the same source
 * IP, so real addresses would make each node filter its siblings out. Instead
 * each node is given `localAddresses: []`: the engine's IP-based own-echo
 * filter becomes a no-op (siblings get through), `DenoTransport` suppresses our
 * OWN loopback datagrams itself, and `localAddresses()` falls back to loopback
 * so advertised services still carry an A/AAAA record.
 *
 * @module
 */

import { createDnsSd, type DnsSd } from "@momics/dns-sd-shared";
import {
  conformanceCases,
  type ConformanceHarness,
} from "@momics/dns-sd-shared/testing";
import { FAST_TIMING } from "@momics/dns-sd-shared";
import { DenoTransport } from "../src/transport.ts";

const NETWORK_TESTS = Deno.env.get("DNS_SD_NETWORK_TESTS") === "1";

/**
 * Build a conformance harness whose nodes share the host's real multicast
 * segment. Each node uses `localAddresses: []` so co-located nodes discover one
 * another (see the module comment) and gets a distinct host name so their
 * A-record owner names don't collide.
 */
function realTransportHarness(): ConformanceHarness {
  const nodes: DnsSd[] = [];
  let counter = 0;
  return {
    createNode(): DnsSd {
      counter++;
      const node = createDnsSd({
        transport: new DenoTransport({
          family: "IPv4",
          hostname: `conformance-node-${counter}.local`,
          localAddresses: [],
          multicastLoopback: true,
        }),
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

for (const c of conformanceCases()) {
  Deno.test({
    name: `conformance (real transport): ${c.name}`,
    ignore: !NETWORK_TESTS,
    async fn() {
      const harness = realTransportHarness();
      try {
        await c.run(harness);
      } finally {
        await harness.cleanup();
      }
    },
  });
}
