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

/**
 * Validate a TXT record key on the advertise/encode path per RFC 6763 §6.3.
 *
 * Only unambiguous, clearly-illegal violations are rejected so that reasonable
 * callers are not broken:
 * - an empty key,
 * - a key containing `=` (the key/value separator),
 * - a key with non-printable or non-ASCII bytes (anything outside 0x20–0x7E).
 *
 * Stylistic nuances (e.g. case-folding heuristics) are intentionally not
 * enforced. Throws a {@link RangeError} describing the first violation found.
 */
function validateTxtKey(key: string): void {
  if (key.length === 0) {
    throw new RangeError("TXT record key must not be empty");
  }
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code === 0x3d /* '=' */) {
      throw new RangeError(
        `TXT record key "${key}" must not contain '=' (the key/value separator)`,
      );
    }
    if (code < 0x20 || code > 0x7e) {
      throw new RangeError(
        `TXT record key "${key}" must contain only printable ASCII (0x20-0x7E)`,
      );
    }
  }
}

/** Normalise caller-supplied TXT input into the codec's attribute form. */
export function encodeTxtInput(
  input: TxtRecordsInput | undefined,
): TxtAttributes {
  const attributes: TxtAttributes = {};
  if (!input) return attributes;
  for (const key of Object.keys(input)) {
    validateTxtKey(key);
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
