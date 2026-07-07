/**
 * Unit tests for {@link DenoTransport}. These exercise the real Deno socket
 * plumbing (bind, receive, close, source mapping, wire-codec round-trip) using
 * **unicast** loopback, so they run everywhere — including CI runners and
 * networks that block multicast routing. Multicast group discovery itself is
 * covered by the (gated) conformance suite in `conformance_test.ts`.
 *
 * Run with: deno task test  (from packages/dns-sd-deno)
 *
 * @module
 */

import {
  assert,
  assertDeepEquals,
  assertEquals,
  test,
} from "@momics/dns-sd-shared/testing/harness";
import { decodeMessage, encodeMessage } from "@momics/dns-sd-shared/wire";
import { DenoTransport } from "../src/transport.ts";

/** Grab a currently-free UDP port by binding an ephemeral socket and releasing it. */
function freeUdpPort(): number {
  const probe = Deno.listenDatagram({
    hostname: "127.0.0.1",
    port: 0,
    transport: "udp",
  });
  const port = (probe.addr as Deno.NetAddr).port;
  probe.close();
  return port;
}

/** Send one unicast datagram to 127.0.0.1:port and close the sender. */
async function sendUnicast(port: number, data: Uint8Array): Promise<void> {
  const sender = Deno.listenDatagram({
    hostname: "127.0.0.1",
    port: 0,
    transport: "udp",
  });
  try {
    await sender.send(data, {
      hostname: "127.0.0.1",
      port,
      transport: "udp",
    });
  } finally {
    sender.close();
  }
}

test("exposes family, group, port and hostname", () => {
  const t = new DenoTransport({
    port: freeUdpPort(),
    hostname: "test-host.local",
    localAddresses: [],
  });
  try {
    assertEquals(t.family, "IPv4");
    assertEquals(t.group, "224.0.0.251");
    assertEquals(t.hostname, "test-host.local");
    assert(typeof t.port === "number" && t.port > 0);
  } finally {
    t.close();
  }
});

test("IPv6 transport defaults to the IPv6 group", () => {
  const t = new DenoTransport({
    family: "IPv6",
    port: freeUdpPort(),
    localAddresses: [],
  });
  try {
    assertEquals(t.family, "IPv6");
    assertEquals(t.group, "ff02::fb");
  } finally {
    t.close();
  }
});

test("localAddresses returns the supplied override", () => {
  const t = new DenoTransport({
    port: freeUdpPort(),
    localAddresses: ["192.0.2.10", "192.0.2.11"],
  });
  try {
    assertDeepEquals(t.localAddresses(), ["192.0.2.10", "192.0.2.11"]);
    // Must hand back a copy, not the internal array.
    t.localAddresses().push("mutated");
    assertDeepEquals(t.localAddresses(), ["192.0.2.10", "192.0.2.11"]);
  } finally {
    t.close();
  }
});

test("localAddresses falls back to loopback when empty", () => {
  const v4 = new DenoTransport({ port: freeUdpPort(), localAddresses: [] });
  try {
    assertDeepEquals(v4.localAddresses(), ["127.0.0.1"]);
  } finally {
    v4.close();
  }
  const v6 = new DenoTransport({
    family: "IPv6",
    port: freeUdpPort(),
    localAddresses: [],
  });
  try {
    assertDeepEquals(v6.localAddresses(), ["::1"]);
  } finally {
    v6.close();
  }
});

test("localAddresses discovery returns an array of strings", () => {
  const t = new DenoTransport({ port: freeUdpPort() });
  try {
    const addrs = t.localAddresses();
    assert(Array.isArray(addrs));
    for (const a of addrs) assert(typeof a === "string");
  } finally {
    t.close();
  }
});

test("receive resolves null after close", async () => {
  const t = new DenoTransport({ port: freeUdpPort(), localAddresses: [] });
  t.close();
  assertEquals(await t.receive(), null);
  // Idempotent close.
  t.close();
  assertEquals(await t.receive(), null);
});

test("receive resolves null when closed while waiting", async () => {
  const t = new DenoTransport({ port: freeUdpPort(), localAddresses: [] });
  const pending = t.receive();
  // Close while the receive is suspended awaiting a datagram.
  setTimeout(() => t.close(), 50);
  assertEquals(await pending, null);
});

test("send is best-effort and never rejects", async () => {
  const t = new DenoTransport({ port: freeUdpPort(), localAddresses: [] });
  try {
    // Even where multicast routing is unavailable, send must resolve, not throw.
    await t.send(new TextEncoder().encode("hello"));
    t.close();
    // Sending after close is a no-op that resolves.
    await t.send(new TextEncoder().encode("after close"));
  } finally {
    t.close();
  }
});

test("setMulticastLoopback and setMulticastTtl resolve", async () => {
  const t = new DenoTransport({ port: freeUdpPort(), localAddresses: [] });
  try {
    await t.setMulticastLoopback(true);
    await t.setMulticastLoopback(false);
    await t.setMulticastTtl(1);
  } finally {
    t.close();
  }
});

test("close immediately after construction with tuning options does not crash", async () => {
  // The constructor fires setMulticastLoopback/Ttl without awaiting; closing
  // before the membership resolves must not surface an unhandled rejection.
  for (let i = 0; i < 5; i++) {
    const t = new DenoTransport({
      port: freeUdpPort(),
      localAddresses: [],
      multicastLoopback: true,
      multicastTtl: 1,
    });
    t.close();
  }
  // Give the deferred tuning promises a tick to settle (and to reject, if buggy).
  await new Promise((r) => setTimeout(r, 50));
});

test("suppresses our own looped-back datagrams", async () => {
  const port = freeUdpPort();
  // Disable multicast loopback so the `send(own)` below cannot also deliver its
  // own multicast copy back to us: on hosts where loopback routing is active
  // (e.g. GitHub's Linux runners) that echo would arrive *in addition* to the
  // injected unicast copy, leaving two `own` datagrams for the single
  // suppression credit and letting one leak through. The injected unicast
  // datagrams below are unaffected by this setting.
  const t = new DenoTransport({
    port,
    localAddresses: [],
    multicastLoopback: false,
  });
  try {
    const own = new Uint8Array([1, 2, 3, 4]);
    const peer = new Uint8Array([9, 9, 9, 9]);
    // Registers `own` for echo suppression (the multicast send itself may
    // no-op on a network without multicast routing — that's fine).
    await t.send(own);
    const received = t.receive();
    // A datagram identical to what we sent looks like our own loopback echo and
    // must be dropped; a genuinely different peer datagram must be delivered.
    await sendUnicast(port, own);
    await sendUnicast(port, peer);
    const datagram = await received;
    assert(datagram !== null, "expected the peer datagram");
    assertDeepEquals(Array.from(datagram.data), Array.from(peer));
  } finally {
    t.close();
  }
});

test("suppresses a large own datagram without a datagram-sized key", async () => {
  // Regression guard for the old O(n^2) full-datagram string key: a large
  // datagram must be suppressed via a fixed-size fingerprint, exactly like Node.
  const port = freeUdpPort();
  const t = new DenoTransport({
    port,
    localAddresses: [],
    multicastLoopback: false,
  });
  try {
    // Large enough that the old per-byte string key would have been ~8 KB and
    // O(n^2) to build, yet within the host's UDP datagram limit on loopback.
    const own = new Uint8Array(8_000);
    for (let i = 0; i < own.length; i++) own[i] = i & 0xff;
    // A peer datagram of the same size but different bytes must still arrive.
    const peer = own.slice();
    peer[0] = own[0]! ^ 0xff;

    await t.send(own);
    const received = t.receive();
    await sendUnicast(port, own); // Looks like our own echo → dropped.
    await sendUnicast(port, peer); // Genuinely different → delivered.
    const datagram = await received;
    assert(datagram !== null, "expected the peer datagram");
    assertEquals(datagram.data.length, peer.length);
    assertEquals(datagram.data[0], peer[0]);
  } finally {
    t.close();
  }
});

test("receive parses a real datagram and its source", async () => {
  const port = freeUdpPort();
  const t = new DenoTransport({ port, localAddresses: [] });
  try {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const received = t.receive();
    await sendUnicast(port, payload);
    const datagram = await received;
    assert(datagram !== null, "expected a datagram");
    assertDeepEquals(Array.from(datagram.data), Array.from(payload));
    assertEquals(datagram.source.address, "127.0.0.1");
    assertEquals(datagram.source.family, "IPv4");
    assert(datagram.source.port > 0);
  } finally {
    t.close();
  }
});

test("wire codec round-trips through a real socket", async () => {
  const port = freeUdpPort();
  const t = new DenoTransport({ port, localAddresses: [] });
  try {
    const message = {
      header: {
        id: 0,
        isResponse: false,
        opcode: 0,
        authoritative: false,
        truncated: false,
        recursionDesired: false,
        recursionAvailable: false,
        rcode: 0,
      },
      questions: [
        {
          name: ["_http", "_tcp", "local"],
          type: 12, // PTR
          class: 1,
          unicastResponse: false,
        },
      ],
      answers: [],
      authorities: [],
      additionals: [],
    };
    const encoded = encodeMessage(message);
    const received = t.receive();
    await sendUnicast(port, encoded);
    const datagram = await received;
    assert(datagram !== null, "expected a datagram");
    const decoded = decodeMessage(datagram.data);
    assertEquals(decoded.questions.length, 1);
    assertEquals(decoded.questions[0]?.type, 12);
    assertDeepEquals(decoded.questions[0]?.name, ["_http", "_tcp", "local"]);
  } finally {
    t.close();
  }
});
