/**
 * Tests for DNS-SD name construction/parsing and TXT conversions.
 *
 * @module
 */

import { assert, assertEquals, test } from "./harness.ts";
import {
  instanceNameLabels,
  namesEqual,
  parseServiceName,
  SERVICE_TYPE_ENUMERATION,
  serviceTypeLabels,
  subtypeServiceLabels,
} from "../src/naming.ts";
import {
  encodeTxtInput,
  txtFromAttributes,
  txtValueToString,
} from "../src/txt.ts";

test("naming: builds service, subtype and instance labels", () => {
  assertEquals(serviceTypeLabels("http", "tcp").join("."), "_http._tcp.local");
  assertEquals(
    serviceTypeLabels("http", "tcp", "example.com").join("."),
    "_http._tcp.example.com",
  );
  assertEquals(
    subtypeServiceLabels("printer", "http", "tcp").join("."),
    "_printer._sub._http._tcp.local",
  );
  assertEquals(
    instanceNameLabels("My Server", "http", "tcp").join("."),
    "My Server._http._tcp.local",
  );
});

test("naming: parses an instance name", () => {
  const parsed = parseServiceName(["My Server", "_http", "_tcp", "local"]);
  assert(parsed, "should parse");
  assertEquals(parsed.instance, "My Server");
  assertEquals(parsed.serviceType, "http");
  assertEquals(parsed.protocol, "tcp");
  assertEquals(parsed.domain, "local");
});

test("naming: parses a bare service type", () => {
  const parsed = parseServiceName(["_ipp", "_udp", "local"]);
  assert(parsed, "should parse");
  assertEquals(parsed.instance, null);
  assertEquals(parsed.serviceType, "ipp");
  assertEquals(parsed.protocol, "udp");
});

test("naming: parses a subtype-scoped type", () => {
  const parsed = parseServiceName(
    ["_printer", "_sub", "_http", "_tcp", "local"],
  );
  assert(parsed, "should parse");
  assertEquals(parsed.subtypes.join(","), "printer");
  assertEquals(parsed.serviceType, "http");
});

test("naming: rejects non-DNS-SD names", () => {
  assertEquals(parseServiceName(["example", "com"]), null);
});

test("naming: case-insensitive name equality", () => {
  assert(namesEqual(["_HTTP", "_TCP", "Local"], ["_http", "_tcp", "local"]));
  assert(!namesEqual(["_http", "_tcp", "local"], ["_ipp", "_tcp", "local"]));
});

test("naming: service-type enumeration constant", () => {
  assertEquals(SERVICE_TYPE_ENUMERATION, "_services._dns-sd._udp.local");
});

test("txt: encodes strings, booleans and nulls", () => {
  const attrs = encodeTxtInput({ path: "/api", secure: true, empty: null });
  assertEquals(new TextDecoder().decode(attrs.path as Uint8Array), "/api");
  assertEquals(attrs.secure, true);
  assertEquals(attrs.empty, null);
});

test("txt: round-trips through the public form", () => {
  const attrs = encodeTxtInput({ k: "v" });
  const records = txtFromAttributes(attrs);
  assertEquals(txtValueToString(records.k!), "v");
});

test("txt: preserves raw bytes", () => {
  const bytes = new Uint8Array([0, 255, 128]);
  const attrs = encodeTxtInput({ blob: bytes });
  assertEquals((attrs.blob as Uint8Array).length, 3);
  assertEquals((attrs.blob as Uint8Array)[1], 255);
});
