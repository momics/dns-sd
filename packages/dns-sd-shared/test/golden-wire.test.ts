/**
 * Golden wire-vector tests: byte-exact DNS-SD / mDNS packets from the real
 * ecosystem, asserted by the codec so on-the-wire behaviour cannot drift
 * (`testing-strategy.md` §2). Each vector in `fixtures/golden-wire.ts` is:
 *
 * 1. **Decoded** and checked structurally against its committed expectation —
 *    the golden assertion.
 * 2. **Round-tripped** semantically (`decode(encode(decode(bytes)))`), proving
 *    the codec preserves the packet's meaning.
 * 3. **Byte-stable** vectors are additionally re-encoded and checked
 *    byte-for-byte, pinning the exact wire output.
 *
 * @module
 */

import {
  assertBytesEqual,
  assertDeepEquals,
  test,
} from "../src/testing/harness.ts";
import { decodeMessage, encodeMessage } from "../src/wire/index.ts";
import { goldenVectors, hexToBytes } from "./fixtures/golden-wire.ts";

for (const vector of goldenVectors) {
  test(`golden: ${vector.name} decodes to the expected structure`, () => {
    const bytes = hexToBytes(vector.hex);
    const decoded = decodeMessage(bytes);
    assertDeepEquals(
      decoded,
      vector.expect,
      `${vector.name}: decoded structure differs from the golden expectation`,
    );

    // Semantic round-trip: re-encoding then decoding preserves the structure.
    const reDecoded = decodeMessage(encodeMessage(decoded));
    assertDeepEquals(
      reDecoded,
      vector.expect,
      `${vector.name}: structure not preserved across encode→decode`,
    );

    // Byte-stable vectors must re-encode to the exact captured/canonical bytes.
    if (vector.byteStable) {
      assertBytesEqual(
        encodeMessage(decoded),
        bytes,
        `${vector.name}: re-encoded bytes differ from the golden vector`,
      );
    }
  });
}
