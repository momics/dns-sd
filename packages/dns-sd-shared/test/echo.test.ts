/**
 * Unit tests for the pure {@link EchoSuppressor}. These exercise the shared
 * self-echo suppression logic that both the Node and Deno UDP transports build
 * on: an FNV-1a fingerprint keyed into a `Map`, consumed exactly once per send
 * and bounded by both a TTL window and an entry cap.
 *
 * @module
 */

import { assert, assertEquals, test } from "../src/testing/harness.ts";
import { EchoSuppressor, fingerprint } from "../src/echo.ts";

test("remember then detect an echo exactly once", () => {
  const s = new EchoSuppressor();
  const packet = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const other = new Uint8Array([0x01, 0x02, 0x03]);

  // A datagram we never sent is not an echo.
  assertEquals(s.consume(other), false);

  // One send → exactly one echo suppressed; a second copy is not.
  s.remember(packet);
  assertEquals(s.consume(packet), true);
  assertEquals(s.consume(packet), false);
});

test("counts duplicate sends and suppresses each echo", () => {
  const s = new EchoSuppressor();
  const packet = new Uint8Array([1, 2, 3, 4]);

  s.remember(packet);
  s.remember(packet);
  assertEquals(s.consume(packet), true);
  assertEquals(s.consume(packet), true);
  assertEquals(s.consume(packet), false);
});

test("expires remembered sends after the TTL window", () => {
  let clock = 1000;
  const s = new EchoSuppressor({ ttlMs: 5000, now: () => clock });
  const packet = new Uint8Array([7, 7, 7]);

  s.remember(packet);
  // Advance past the TTL window: the remembered send is no longer an echo.
  clock = 1000 + 5001;
  assertEquals(s.consume(packet), false);
});

test("still suppresses within the TTL window", () => {
  let clock = 0;
  const s = new EchoSuppressor({ ttlMs: 5000, now: () => clock });
  const packet = new Uint8Array([9, 9]);

  s.remember(packet);
  clock = 4999;
  assertEquals(s.consume(packet), true);
});

test("caps the number of tracked entries, evicting the oldest", () => {
  const s = new EchoSuppressor({ maxEntries: 2 });
  const a = new Uint8Array([1]);
  const b = new Uint8Array([2]);
  const c = new Uint8Array([3]);

  s.remember(a);
  s.remember(b);
  s.remember(c); // Evicts `a`.

  assertEquals(s.consume(a), false);
  assertEquals(s.consume(b), true);
  assertEquals(s.consume(c), true);
});

test("fingerprint is bounded and independent of datagram size", () => {
  const small = new Uint8Array([1, 2, 3]);
  const large = new Uint8Array(64 * 1024).fill(0xab);

  const fpLarge = fingerprint(large);
  // A fixed-size key: never a datagram-sized string.
  assert(fpLarge.length < 32, `fingerprint too long: ${fpLarge.length}`);
  // Length is part of the key, so different-length buffers never collide.
  assert(fingerprint(small) !== fpLarge);
});

test("clear() forgets all remembered sends", () => {
  const s = new EchoSuppressor();
  const packet = new Uint8Array([5, 5, 5]);
  s.remember(packet);
  s.clear();
  assertEquals(s.consume(packet), false);
});
