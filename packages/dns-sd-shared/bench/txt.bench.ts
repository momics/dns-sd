/**
 * Hot-path benchmarks for the TXT attribute codec (`src/txt.ts`).
 *
 * TXT normalisation runs on every advertise (encode) and every resolved
 * instance (decode) in a DNS-SD browse, so both directions are on the hot path
 * (RFC 6763 §6).
 *
 * @module
 */

import { encodeTxtInput, txtFromAttributes } from "../src/txt.ts";
import type { TxtRecordsInput } from "../src/types.ts";
import { browseTxtAttributes } from "./fixtures.ts";

const input: TxtRecordsInput = {
  txtvers: "1",
  path: "/index.html",
  u: "admin",
  p: "s3cr3t",
  color: "blue",
  flag: true,
  empty: null,
};

const attributes = browseTxtAttributes();

Deno.bench("txt/encode: normalise service attributes", () => {
  encodeTxtInput(input);
});

Deno.bench("txt/decode: attributes to public records", () => {
  txtFromAttributes(attributes);
});
