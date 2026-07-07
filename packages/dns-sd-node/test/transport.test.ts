/**
 * Unit tests for {@link NodeTransport} that need no real multicast network, so
 * they always run (including in headless CI). The real-network conformance
 * suite lives in `conformance.test.ts`, gated behind `DNS_SD_NETWORK_TESTS=1`.
 *
 * @module
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeTransport } from "../src/transport.ts";

/** A narrow view of the transport's self-echo internals, for white-box tests. */
interface EchoInternals {
  rememberSent(data: Uint8Array): void;
  isOwnEcho(data: Uint8Array): boolean;
}

test("defaults to IPv4 and a .local hostname", () => {
  const t = new NodeTransport();
  try {
    assert.equal(t.family, "IPv4");
    assert.match(t.hostname, /\.local$/);
  } finally {
    t.close();
  }
});

test("honours an explicit family and hostname", () => {
  const t = new NodeTransport({ family: "IPv6", hostname: "device-1" });
  try {
    assert.equal(t.family, "IPv6");
    assert.equal(t.hostname, "device-1.local");
  } finally {
    t.close();
  }
});

test("preserves a hostname that is already .local", () => {
  const t = new NodeTransport({ hostname: "already.local" });
  try {
    assert.equal(t.hostname, "already.local");
  } finally {
    t.close();
  }
});

test("localAddresses returns a defensive copy of the override", () => {
  const t = new NodeTransport({ localAddresses: ["10.0.0.1", "10.0.0.2"] });
  try {
    const first = t.localAddresses();
    assert.deepEqual(first, ["10.0.0.1", "10.0.0.2"]);
    first.push("mutated");
    assert.deepEqual(t.localAddresses(), ["10.0.0.1", "10.0.0.2"]);
  } finally {
    t.close();
  }
});

test("localAddresses auto-detection returns string addresses", () => {
  const t = new NodeTransport();
  try {
    const addrs = t.localAddresses();
    assert.ok(Array.isArray(addrs));
    for (const a of addrs) assert.equal(typeof a, "string");
  } finally {
    t.close();
  }
});

test("receive() resolves null after close()", async () => {
  const t = new NodeTransport({ localAddresses: [] });
  t.close();
  assert.equal(await t.receive(), null);
});

test("a parked receive() resolves null when the transport closes", async () => {
  const t = new NodeTransport({ localAddresses: [] });
  const pending = t.receive();
  t.close();
  assert.equal(await pending, null);
});

test("send() after close() resolves without throwing", async () => {
  const t = new NodeTransport({ localAddresses: [] });
  t.close();
  await t.send(new Uint8Array([1, 2, 3]));
});

test("multicast tuning hooks never throw before bind", () => {
  const t = new NodeTransport({ localAddresses: [] });
  try {
    t.setMulticastTtl(1);
    t.setMulticastLoopback(false);
    t.setMulticastLoopback(true);
  } finally {
    t.close();
  }
});

test("close() is idempotent", () => {
  const t = new NodeTransport({ localAddresses: [] });
  t.close();
  t.close();
});

test("self-echo suppression drops our own datagrams exactly once each", () => {
  const t = new NodeTransport({ localAddresses: [] });
  try {
    const internals = t as unknown as EchoInternals;
    const packet = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const other = new Uint8Array([0x01, 0x02, 0x03]);

    // A packet we never sent is not treated as an echo.
    assert.equal(internals.isOwnEcho(other), false);

    // One send → exactly one echo is suppressed; a second copy is not.
    internals.rememberSent(packet);
    assert.equal(internals.isOwnEcho(packet), true);
    assert.equal(internals.isOwnEcho(packet), false);

    // Two sends of identical bytes → two echoes suppressed.
    internals.rememberSent(packet);
    internals.rememberSent(packet);
    assert.equal(internals.isOwnEcho(packet), true);
    assert.equal(internals.isOwnEcho(packet), true);
    assert.equal(internals.isOwnEcho(packet), false);
  } finally {
    t.close();
  }
});
