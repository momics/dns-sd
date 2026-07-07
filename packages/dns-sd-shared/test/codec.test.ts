/**
 * Wire-codec tests: round-trips, known byte vectors, name compression, and
 * malformed / hostile packet hardening.
 *
 * @module
 */

import {
  assert,
  assertBytesEqual,
  assertEquals,
  assertThrows,
  test,
} from "../src/testing/harness.ts";
import {
  decodeMessage,
  DnsClass,
  type DnsMessage,
  encodeMessage,
  isA,
  isPTR,
  isSRV,
  isTXT,
  Reader,
  ResourceType,
  WireError,
} from "../src/wire/index.ts";

function queryHeader(): DnsMessage["header"] {
  return {
    id: 0,
    isResponse: false,
    opcode: 0,
    authoritative: false,
    truncated: false,
    recursionDesired: false,
    recursionAvailable: false,
    rcode: 0,
  };
}

function responseHeader(): DnsMessage["header"] {
  return { ...queryHeader(), isResponse: true, authoritative: true };
}

test("codec: PTR query round-trips byte-stably", () => {
  const msg: DnsMessage = {
    header: queryHeader(),
    questions: [{
      name: ["_http", "_tcp", "local"],
      type: ResourceType.PTR,
      class: DnsClass.IN,
      unicastResponse: false,
    }],
    answers: [],
    authorities: [],
    additionals: [],
  };
  const bytes = encodeMessage(msg);
  const decoded = decodeMessage(bytes);
  assertEquals(decoded.questions.length, 1);
  assertEquals(decoded.questions[0]!.type, ResourceType.PTR);
  assertEquals(decoded.questions[0]!.name.join("."), "_http._tcp.local");
  assertBytesEqual(encodeMessage(decoded), bytes);
});

test("codec: known byte vector for a QNAME + QTYPE + QCLASS", () => {
  const msg: DnsMessage = {
    header: queryHeader(),
    questions: [{
      name: ["_http", "_tcp", "local"],
      type: ResourceType.PTR,
      class: DnsClass.IN,
      unicastResponse: false,
    }],
    answers: [],
    authorities: [],
    additionals: [],
  };
  const bytes = encodeMessage(msg);
  // 12-byte header, then the encoded question.
  const header = bytes.slice(0, 12);
  assertBytesEqual(
    header,
    new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
    "header should have QDCOUNT=1 and all else zero",
  );
  const question = bytes.slice(12);
  const expected = new Uint8Array([
    5,
    0x5f,
    0x68,
    0x74,
    0x74,
    0x70, // "_http"
    4,
    0x5f,
    0x74,
    0x63,
    0x70, // "_tcp"
    5,
    0x6c,
    0x6f,
    0x63,
    0x61,
    0x6c, // "local"
    0, // root
    0,
    12, // QTYPE = PTR
    0,
    1, // QCLASS = IN
  ]);
  assertBytesEqual(question, expected);
});

test("codec: full DNS-SD response round-trips byte-stably", () => {
  const instance = ["My Service", "_http", "_tcp", "local"];
  const service = ["_http", "_tcp", "local"];
  const host = ["my-host", "local"];
  const msg: DnsMessage = {
    header: responseHeader(),
    questions: [],
    answers: [
      {
        name: service,
        type: ResourceType.PTR,
        class: DnsClass.IN,
        ttl: 4500,
        flush: false,
        data: { kind: "PTR", name: instance },
      },
      {
        name: instance,
        type: ResourceType.SRV,
        class: DnsClass.IN,
        ttl: 120,
        flush: true,
        data: { kind: "SRV", priority: 0, weight: 0, port: 8080, target: host },
      },
      {
        name: instance,
        type: ResourceType.TXT,
        class: DnsClass.IN,
        ttl: 120,
        flush: true,
        data: {
          kind: "TXT",
          attributes: {
            path: new TextEncoder().encode("/api"),
            secure: true,
            empty: null,
          },
        },
      },
      {
        name: host,
        type: ResourceType.A,
        class: DnsClass.IN,
        ttl: 120,
        flush: true,
        data: { kind: "A", address: [192, 168, 1, 42] },
      },
    ],
    authorities: [],
    additionals: [],
  };
  const bytes = encodeMessage(msg);
  const decoded = decodeMessage(bytes);
  assertEquals(decoded.answers.length, 4);

  const ptr = decoded.answers.find(isPTR)!;
  assertEquals(ptr.data.name.join("."), "My Service._http._tcp.local");

  const srv = decoded.answers.find(isSRV)!;
  assertEquals(srv.data.port, 8080);
  assertEquals(srv.data.target.join("."), "my-host.local");
  assertEquals(srv.flush, true);

  const txt = decoded.answers.find(isTXT)!;
  assertEquals(
    new TextDecoder().decode(txt.data.attributes.path as Uint8Array),
    "/api",
  );
  assertEquals(txt.data.attributes.secure, true);
  assertEquals(txt.data.attributes.empty, null);

  const a = decoded.answers.find(isA)!;
  assertEquals(a.data.address.join("."), "192.168.1.42");

  // Byte-stability: re-encoding the decoded message reproduces the bytes.
  assertBytesEqual(encodeMessage(decoded), bytes);
});

test("codec: name compression is used and decodes correctly", () => {
  // Two records sharing the "_http._tcp.local" suffix should compress.
  const service = ["_http", "_tcp", "local"];
  const instance = ["Instance", "_http", "_tcp", "local"];
  const msg: DnsMessage = {
    header: responseHeader(),
    questions: [],
    answers: [
      {
        name: service,
        type: ResourceType.PTR,
        class: DnsClass.IN,
        ttl: 4500,
        flush: false,
        data: { kind: "PTR", name: instance },
      },
    ],
    authorities: [],
    additionals: [],
  };
  const bytes = encodeMessage(msg);
  // A pointer byte (0xC0…) must appear somewhere in the RDATA region.
  const hasPointer = Array.from(bytes).some((b) => (b & 0xc0) === 0xc0);
  assert(hasPointer, "expected a compression pointer in the encoded message");
  const decoded = decodeMessage(bytes);
  const ptr = decoded.answers.find(isPTR)!;
  assertEquals(ptr.name.join("."), "_http._tcp.local");
  assertEquals(ptr.data.name.join("."), "Instance._http._tcp.local");
});

test("codec: AAAA round-trips", () => {
  const msg: DnsMessage = {
    header: responseHeader(),
    questions: [],
    answers: [{
      name: ["host", "local"],
      type: ResourceType.AAAA,
      class: DnsClass.IN,
      ttl: 120,
      flush: true,
      data: { kind: "AAAA", address: "fe80::1" },
    }],
    authorities: [],
    additionals: [],
  };
  const bytes = encodeMessage(msg);
  const decoded = decodeMessage(bytes);
  assertBytesEqual(encodeMessage(decoded), bytes);
});

function nsecMessage(types: number[]): DnsMessage {
  return {
    header: responseHeader(),
    questions: [],
    answers: [{
      name: ["host", "local"],
      type: ResourceType.NSEC,
      class: DnsClass.IN,
      ttl: 120,
      flush: true,
      data: { kind: "NSEC", nextDomainName: ["host", "local"], types },
    }],
    authorities: [],
    additionals: [],
  };
}

test("codec: NSEC round-trips", () => {
  const bytes = encodeMessage(
    nsecMessage([ResourceType.PTR, ResourceType.SRV]),
  );
  const decoded = decodeMessage(bytes);
  const answer = decoded.answers[0]!;
  assert(answer.data.kind === "NSEC");
  assertEquals(
    answer.data.types.sort((a, b) => a - b).join(","),
    [ResourceType.PTR, ResourceType.SRV].join(","),
  );
  assertBytesEqual(encodeMessage(decoded), bytes);
});

test("codec: NSEC with no types is rejected on encode", async () => {
  // A zero-length bitmap window is not decodable, so the encoder must refuse
  // it rather than emit bytes its own decoder rejects.
  await assertThrows(
    () => encodeMessage(nsecMessage([])),
    (e) => e instanceof RangeError,
  );
});

// ── Hardening ─────────────────────────────────────────────────────────────────

test("hardening: truncated header throws WireError, not a panic", async () => {
  await assertThrows(
    () => decodeMessage(new Uint8Array([0, 0, 0])),
    (e) => e instanceof WireError,
  );
});

test("hardening: label length running past the buffer throws", async () => {
  // Header claims 1 question; QNAME starts with a length byte (63) but no data.
  const bytes = new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 63]);
  await assertThrows(
    () => decodeMessage(bytes),
    (e) => e instanceof WireError,
  );
});

test("hardening: compression pointer loop is rejected", async () => {
  // A name whose pointer points at itself must not hang or overflow.
  const bytes = new Uint8Array([
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    0, // header, QD=1
    0xc0,
    0x0c, // pointer to offset 12 (itself)
  ]);
  await assertThrows(
    () => decodeMessage(bytes),
    (e) => e instanceof WireError,
  );
});

test("hardening: forward-pointing compression pointer is rejected", async () => {
  const bytes = new Uint8Array([
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    0, // header, QD=1
    0xc0,
    0x20, // pointer to offset 32 (forward / out of range)
  ]);
  await assertThrows(
    () => decodeMessage(bytes),
    (e) => e instanceof WireError,
  );
});

test("hardening: RDLENGTH past end of buffer throws", async () => {
  const bytes = new Uint8Array([
    0,
    0,
    0x84,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0, // header: response, AN=1
    1,
    0x61,
    0, // name "a"
    0,
    1, // TYPE A
    0,
    1, // CLASS IN
    0,
    0,
    0,
    120, // TTL
    0,
    200, // RDLENGTH = 200 (way past end)
    1,
    2,
    3,
    4,
  ]);
  await assertThrows(
    () => decodeMessage(bytes),
    (e) => e instanceof WireError,
  );
});

test("hardening: fuzzing random packets never panics", () => {
  let rejected = 0;
  let decoded = 0;
  for (let i = 0; i < 500; i++) {
    const len = Math.floor(Math.random() * 64);
    const bytes = new Uint8Array(len);
    for (let j = 0; j < len; j++) bytes[j] = Math.floor(Math.random() * 256);
    try {
      decodeMessage(bytes);
      decoded++;
    } catch (e) {
      if (!(e instanceof WireError)) {
        throw new Error(
          `unexpected non-WireError from fuzz input: ${String(e)}`,
        );
      }
      rejected++;
    }
  }
  assert(rejected + decoded === 500, "every fuzz input should be handled");
});

test("Reader: bounds are enforced on primitive reads", async () => {
  const r = new Reader(new Uint8Array([1, 2]));
  assertEquals(r.u8(), 1);
  assertEquals(r.u8(), 2);
  await assertThrows(() => r.u8(), (e) => e instanceof WireError);
});
