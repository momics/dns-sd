/**
 * The shared conformance suite, run against the REAL {@link NodeTransport} over
 * UDP multicast. Every node created by the harness binds a real `dgram` socket
 * joined to the mDNS group, so the whole suite exercises genuine on-the-wire
 * behaviour on the local multicast segment.
 *
 * These tests need a working multicast loopback path, which headless CI
 * containers often lack, so they are gated behind `DNS_SD_NETWORK_TESTS=1`.
 * Run them locally with:
 *
 * ```bash
 * DNS_SD_NETWORK_TESTS=1 npm run test:node --workspace @momics/dns-sd-node
 * ```
 *
 * @module
 */

import { test } from "node:test";
import process from "node:process";
import { createDnsSd, FAST_TIMING } from "@momics/dns-sd-shared";
import type { DnsSd } from "@momics/dns-sd-shared";
import {
  type ConformanceCase,
  conformanceCases,
  type ConformanceHarness,
} from "@momics/dns-sd-shared/testing";
import { NodeTransport } from "../src/transport.ts";

const networkEnabled = process.env["DNS_SD_NETWORK_TESTS"] === "1";

/**
 * A conformance harness whose nodes are real Node transports sharing the host's
 * multicast segment. Each transport reports no "own" addresses so the engine
 * doesn't cross-filter the sibling sockets that share this host's IP; the
 * transport still suppresses each node's own looped-back datagrams.
 */
function nodeHarness(): ConformanceHarness {
  const nodes: DnsSd[] = [];
  return {
    createNode(): DnsSd {
      const transport = new NodeTransport({ localAddresses: [] });
      const node = createDnsSd({ transport, timing: FAST_TIMING });
      nodes.push(node);
      return node;
    },
    async cleanup(): Promise<void> {
      for (const node of nodes) await node.close();
    },
  };
}

for (const c of conformanceCases()) {
  registerCase(c);
}

function registerCase(c: ConformanceCase): void {
  const options = networkEnabled
    ? {}
    : { skip: "set DNS_SD_NETWORK_TESTS=1 to run real-network conformance" };
  test(`conformance: ${c.name}`, options, async () => {
    const harness = nodeHarness();
    try {
      await c.run(harness);
    } finally {
      await harness.cleanup();
    }
  });
}
