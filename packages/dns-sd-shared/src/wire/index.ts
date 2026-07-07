/**
 * Standards-compliant DNS / mDNS wire codec (RFC 1035, RFC 6762, RFC 6763).
 *
 * @module
 */

export * from "./types.ts";
export { decodeMessage } from "./decode.ts";
export { encodeIpv6, encodeMessage } from "./encode.ts";
export { Reader, WireError } from "./reader.ts";
