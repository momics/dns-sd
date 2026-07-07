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
import { DnsClass, type DnsMessage, ResourceType } from "../src/wire/index.ts";
import { FAST_TIMING } from "../src/engine/constants.ts";
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
