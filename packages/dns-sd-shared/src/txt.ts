/**
 * Conversions between the public TXT record shapes and the wire-codec's
 * {@link TxtAttributes} form.
 *
 * @module
 */

import type { TxtAttributes } from "./wire/types.ts";
import type {
  TxtRecordInput,
  TxtRecords,
  TxtRecordsInput,
  TxtValue,
} from "./types.ts";

const utf8 = new TextEncoder();

/** Normalise caller-supplied TXT input into the codec's attribute form. */
export function encodeTxtInput(
  input: TxtRecordsInput | undefined,
): TxtAttributes {
  const attributes: TxtAttributes = {};
  if (!input) return attributes;
  for (const key of Object.keys(input)) {
    attributes[key] = normalizeTxtValue(key, input[key]);
  }
  return attributes;
}

function normalizeTxtValue(
  key: string,
  value: TxtRecordInput | undefined,
): TxtValue {
  if (value === true) return true;
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return utf8.encode(value);
  throw new TypeError(
    `TXT record "${key}" must be a string, Uint8Array, true, or null`,
  );
}

/** Convert decoded codec attributes into the public {@link TxtRecords} form. */
export function txtFromAttributes(attributes: TxtAttributes): TxtRecords {
  const out: TxtRecords = {};
  for (const key of Object.keys(attributes)) {
    out[key] = attributes[key] as TxtValue;
  }
  return out;
}

/** Decode a TXT value to a UTF-8 string, or `null`/`true` for the special forms. */
export function txtValueToString(value: TxtValue): string | true | null {
  if (value === true || value === null) return value;
  return new TextDecoder().decode(value);
}
