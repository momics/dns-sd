/**
 * Hot-path benchmarks for the DNS wire codec (`src/wire/`).
 *
 * `encodeMessage` and `decodeMessage` run on every datagram an mDNS responder
 * sends or receives, so they are the throughput-critical core of the library.
 * The benchmarks exercise them on a realistic DNS-SD browse response (see
 * `fixtures.ts`) rather than a synthetic micro-input.
 *
 * Run directly with `deno bench`; the committed baseline and the regression
 * gate live in `scripts/perf-gate.ts`.
 *
 * @module
 */

import { decodeMessage, encodeMessage } from "../src/wire/index.ts";
import { browseResponse, browseResponseBytes } from "./fixtures.ts";

const message = browseResponse();
const bytes = browseResponseBytes();

Deno.bench("wire/encode: browse response", () => {
  encodeMessage(message);
});

Deno.bench("wire/decode: browse response", () => {
  decodeMessage(bytes);
});

Deno.bench("wire/roundtrip: browse response", () => {
  decodeMessage(encodeMessage(message));
});
