/**
 * Focused tests for the responder's RFC 6762 §6 response aggregation delay.
 *
 * A query must not produce an immediate multicast response; instead the
 * responder buffers computed answers and flushes them after a random delay in
 * `[responseAggregationMinMs, responseAggregationMaxMs]`. Multiple answers that
 * accumulate within one window are coalesced into a single response.
 *
 * @module
 */

import { assert, assertEquals, test } from "../src/testing/harness.ts";
import {
  DnsClass,
  type DnsMessage,
  type ResourceRecord,
  ResourceType,
} from "../src/wire/index.ts";
import { FAST_TIMING, TTL_SHARED } from "../src/engine/constants.ts";
import { Responder, type ResponderContext } from "../src/engine/responder.ts";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Harness {
  responder: Responder;
  /** All response messages (isResponse=true) captured after announcing. */
  responses: DnsMessage[];
  /** Reset the capture buffer (drops probe/announce traffic). */
  reset(): void;
}

/** Build an announcing responder over a capturing mock context. */
async function announcingResponder(): Promise<Harness> {
  const sent: DnsMessage[] = [];
  const ctx: ResponderContext = {
    timing: FAST_TIMING,
    family: "IPv4",
    hostname: "myhost.local",
    localAddresses: () => ["10.0.0.5"],
    send: (m) => sent.push(m),
    register: () => {},
    unregister: () => {},
  };
  const responder = new Responder(ctx, {
    type: "http",
    protocol: "tcp",
    name: "Web Server",
    port: 8080,
    txt: { path: "/" },
  });
  await responder.start();
  // Let the trailing announcement(s) flush before we start capturing queries.
  await delay(FAST_TIMING.announceIntervalMs * FAST_TIMING.announceCount + 10);
  return {
    responder,
    get responses() {
      return sent.filter((m) => m.header.isResponse);
    },
    reset() {
      sent.length = 0;
    },
  };
}

/** A multicast (QM) query for a single name/type. */
function query(name: string[], type: ResourceType): DnsMessage {
  return {
    header: {
      id: 0,
      isResponse: false,
      opcode: 0,
      authoritative: false,
      truncated: false,
      recursionDesired: false,
      recursionAvailable: false,
      rcode: 0,
    },
    questions: [{ name, type, class: DnsClass.IN, unicastResponse: false }],
    answers: [],
    authorities: [],
    additionals: [],
  };
}

const SERVICE = ["_http", "_tcp", "local"];
const HOST = ["myhost", "local"];
const INSTANCE = ["Web Server", "_http", "_tcp", "local"];

/** A query carrying `known` answers (for known-answer suppression). */
function queryWithKnown(
  name: string[],
  type: ResourceType,
  known: ResourceRecord[],
): DnsMessage {
  const m = query(name, type);
  m.answers = known;
  return m;
}

/** A probe query: a question plus proposed records in the Authority Section. */
function probeQuery(name: string[], type: ResourceType): DnsMessage {
  const m = query(name, type);
  m.authorities = [{
    name,
    type: ResourceType.SRV,
    class: DnsClass.IN,
    ttl: 120,
    flush: true,
    data: { kind: "SRV", priority: 0, weight: 0, port: 1, target: HOST },
  }];
  return m;
}

/** Our own PTR record, usable as a "known answer" to suppress the PTR. */
function knownPtr(): ResourceRecord {
  return {
    name: SERVICE,
    type: ResourceType.PTR,
    class: DnsClass.IN,
    ttl: TTL_SHARED,
    flush: false,
    data: { kind: "PTR", name: INSTANCE },
  };
}

test("responder: a query is not answered immediately but within the window", async () => {
  const h = await announcingResponder();
  h.reset();

  h.responder.onQuery(query(SERVICE, ResourceType.PTR));
  // No synchronous send: the response is delayed for aggregation.
  assertEquals(h.responses.length, 0, "response must not be sent immediately");

  // Well before the minimum aggregation delay nothing should have been sent
  // yet (min = 1ms in the fast profile, so this margin is deliberately tiny).
  await delay(FAST_TIMING.responseAggregationMaxMs + 30);
  assertEquals(
    h.responses.length,
    1,
    "exactly one aggregated response within the window",
  );
  const answered = h.responses[0]!;
  assert(
    answered.answers.some((a) => a.type === ResourceType.PTR),
    "aggregated response should contain the PTR answer",
  );

  await h.responder.stop();
});

test("responder: answers accumulated within one window are coalesced", async () => {
  const h = await announcingResponder();
  h.reset();

  // Two distinct queries arriving inside the same aggregation window.
  h.responder.onQuery(query(SERVICE, ResourceType.PTR));
  h.responder.onQuery(query(HOST, ResourceType.A));
  assertEquals(h.responses.length, 0, "still buffered, nothing sent yet");

  await delay(FAST_TIMING.responseAggregationMaxMs + 30);
  assertEquals(
    h.responses.length,
    1,
    "the two queries coalesce into a single response",
  );
  const answered = h.responses[0]!;
  assert(
    answered.answers.some((a) => a.type === ResourceType.PTR),
    "coalesced response should include the PTR answer",
  );
  assert(
    answered.answers.some((a) => a.type === ResourceType.A),
    "coalesced response should include the A answer",
  );

  await h.responder.stop();
});

test("responder: additionals are recomputed at flush for a coalesced PTR answer", async () => {
  const h = await announcingResponder();
  h.reset();

  h.responder.onQuery(query(SERVICE, ResourceType.PTR));
  await delay(FAST_TIMING.responseAggregationMaxMs + 30);
  assertEquals(h.responses.length, 1, "one aggregated response");
  const additionals = h.responses[0]!.additionals;
  assert(
    additionals.some((a) => a.type === ResourceType.SRV),
    "additionals should include the SRV record",
  );
  assert(
    additionals.some((a) => a.type === ResourceType.TXT),
    "additionals should include the TXT record",
  );
  assert(
    additionals.some((a) => a.type === ResourceType.A),
    "additionals should include the A record",
  );

  await h.responder.stop();
});

test("responder: known-answer suppression carries across a coalesced window", async () => {
  const h = await announcingResponder();
  h.reset();

  // First query suppresses the PTR via a known answer; second query asks for
  // the A record. The coalesced response must include A but omit the PTR.
  h.responder.onQuery(
    queryWithKnown(SERVICE, ResourceType.PTR, [knownPtr()]),
  );
  h.responder.onQuery(query(HOST, ResourceType.A));

  await delay(FAST_TIMING.responseAggregationMaxMs + 30);
  assertEquals(h.responses.length, 1, "one aggregated response");
  const answered = h.responses[0]!;
  assert(
    answered.answers.some((a) => a.type === ResourceType.A),
    "unsuppressed A answer should be present",
  );
  assert(
    !answered.answers.some((a) => a.type === ResourceType.PTR),
    "suppressed PTR answer should be omitted from the coalesced response",
  );

  await h.responder.stop();
});

test("responder: a probe query is answered immediately, bypassing aggregation", async () => {
  const h = await announcingResponder();
  h.reset();

  // A probe (question + proposed records in the Authority Section) for one of
  // our names must be defended immediately (RFC 6762 §6), not aggregated.
  h.responder.onQuery(probeQuery(INSTANCE, ResourceType.ANY));
  assertEquals(
    h.responses.length,
    1,
    "probe defense must be an immediate, non-delayed response",
  );

  // A normal query in the same instant still aggregates (no extra immediate send).
  h.reset();
  h.responder.onQuery(query(SERVICE, ResourceType.PTR));
  assertEquals(h.responses.length, 0, "normal query is still delayed");
  await delay(FAST_TIMING.responseAggregationMaxMs + 30);
  assertEquals(h.responses.length, 1, "normal query flushes within the window");

  await h.responder.stop();
});

test("responder: aggregation still works after a steady-state reprobe", async () => {
  const h = await announcingResponder();
  h.reset();

  // Open an aggregation window (a flush timer is now pending)...
  h.responder.onQuery(query(SERVICE, ResourceType.PTR));
  // ...then trigger a steady-state conflict on a unique record, which reprobes
  // and cancels all timers. The aggregation state must be reset too, otherwise
  // the responder silently stops answering every future query.
  const base = query(HOST, ResourceType.A);
  const conflicting: DnsMessage = {
    ...base,
    header: { ...base.header, isResponse: true },
    answers: [{
      name: HOST,
      type: ResourceType.A,
      class: DnsClass.IN,
      ttl: 120,
      flush: true,
      data: { kind: "A", address: [9, 9, 9, 9] },
    }],
  };
  h.responder.onResponse(conflicting);

  // A subsequent query must still schedule and flush an aggregated response.
  h.reset();
  h.responder.onQuery(query(SERVICE, ResourceType.PTR));
  assertEquals(h.responses.length, 0, "still buffered, not immediate");
  await delay(FAST_TIMING.responseAggregationMaxMs + 8);
  assert(
    h.responses.some((m) => m.answers.some((a) => a.type === ResourceType.PTR)),
    "responder must still answer queries after a reprobe",
  );

  await h.responder.stop();
});
