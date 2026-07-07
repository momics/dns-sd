/**
 * Tests for the adapter path of {@link dnsSdOverAdapter}, focused on the
 * lifecycle of the browse handle: early teardown of a browse (via timeout or
 * abort signal) must tear down the underlying adapter handle, and it must do
 * so exactly once even though `withStop` invokes its stop closure both on the
 * triggering event and again in its `finally` block.
 *
 * @module
 */

import { assert, assertEquals, test } from "../src/testing/harness.ts";
import { dnsSdOverAdapter } from "../src/api.ts";
import type {
  AdapterAdvertiseHandle,
  AdapterBrowseHandle,
  DnsSdAdapter,
  ServiceSink,
} from "../src/seams/adapter.ts";
import type { BrowseServiceSpec } from "../src/types.ts";

interface StubResult {
  adapter: DnsSdAdapter;
  browseStops: () => number;
}

function makeStubAdapter(): StubResult {
  let stops = 0;
  const adapter: DnsSdAdapter = {
    browseStart(
      _spec: BrowseServiceSpec,
      _sink: ServiceSink,
    ): Promise<AdapterBrowseHandle> {
      return Promise.resolve({
        stop(): Promise<void> {
          stops++;
          return Promise.resolve();
        },
      });
    },
    advertiseStart(): Promise<AdapterAdvertiseHandle> {
      throw new Error("not used");
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
  return { adapter, browseStops: () => stops };
}

const service: BrowseServiceSpec = { type: "http", protocol: "tcp" };

/** Let queued microtasks (the deferred `handlePromise.then(...)`) drain. */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

test("adapter browse stops the handle exactly once on timeout teardown", async () => {
  const { adapter, browseStops } = makeStubAdapter();
  const dnsSd = dnsSdOverAdapter(adapter);
  const gen = dnsSd.browse({ service, timeoutMs: 5 });
  const result = await gen.next();
  assert(result.done === true, "generator should complete on timeout");
  await drainMicrotasks();
  assertEquals(
    browseStops(),
    1,
    "timeout teardown should stop the handle exactly once",
  );
  // Draining the generator again must not stop a second time.
  await gen.return();
  await drainMicrotasks();
  assertEquals(browseStops(), 1, "handle.stop() must not run twice");
});

test("adapter browse stops the handle exactly once on abort teardown", async () => {
  const { adapter, browseStops } = makeStubAdapter();
  const dnsSd = dnsSdOverAdapter(adapter);
  const controller = new AbortController();
  const gen = dnsSd.browse({ service, signal: controller.signal });
  const next = gen.next();
  controller.abort();
  const result = await next;
  assert(result.done === true, "generator should complete on abort");
  await drainMicrotasks();
  assertEquals(
    browseStops(),
    1,
    "abort teardown should stop the handle exactly once",
  );
});

test("adapter browse stops the handle when the signal is already aborted", async () => {
  const { adapter, browseStops } = makeStubAdapter();
  const dnsSd = dnsSdOverAdapter(adapter);
  const gen = dnsSd.browse({ service, signal: AbortSignal.abort() });
  const result = await gen.next();
  assert(result.done === true, "generator should complete immediately");
  await drainMicrotasks();
  assertEquals(browseStops(), 1, "pre-aborted teardown should stop once");
});
