/**
 * Tests for the adapter path of {@link dnsSdOverAdapter}, focused on the
 * lifecycle of the browse handle: early teardown of a browse (via timeout or
 * abort signal) must tear down the underlying adapter handle, and it must do
 * so exactly once even though `withStop` invokes its stop closure both on the
 * triggering event and again in its `finally` block.
 *
 * @module
 */

import {
  assert,
  assertEquals,
  assertThrows,
  test,
} from "../src/testing/harness.ts";
import { createDnsSd, dnsSdOverAdapter } from "../src/api.ts";
import type {
  AdapterAdvertiseHandle,
  AdapterBrowseHandle,
  DnsSdAdapter,
  ServiceSink,
} from "../src/seams/adapter.ts";
import type { AdvertiseServiceSpec, BrowseServiceSpec } from "../src/types.ts";
import { VirtualBus } from "../src/testing/loopback.ts";
import { FAST_TIMING } from "../src/engine/constants.ts";

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

const advertiseSpec: AdvertiseServiceSpec = {
  name: "My Web Server",
  type: "http",
  protocol: "tcp",
  port: 8080,
};

/**
 * A mock adapter whose `advertiseStart` reports the fully-qualified name the way
 * a real OS resolver would, so we can assert the adapter path threads `fullName`
 * through instead of aliasing it to the bare instance name.
 */
function advertisingAdapter(fullName: string): DnsSdAdapter {
  return {
    browseStart(): Promise<AdapterBrowseHandle> {
      throw new Error("not used");
    },
    advertiseStart(
      spec: AdvertiseServiceSpec,
    ): Promise<AdapterAdvertiseHandle> {
      return Promise.resolve({
        name: spec.name,
        fullName,
        stop(): Promise<void> {
          return Promise.resolve();
        },
      });
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}

test("adapter advertise().fullName is the FQN and matches the transport path", async () => {
  // The FQN a real OS resolver would report for this instance.
  const expectedFullName = "My Web Server._http._tcp.local";

  const adapterDnsSd = dnsSdOverAdapter(advertisingAdapter(expectedFullName));
  const adapterHandle = await adapterDnsSd.advertise({
    service: advertiseSpec,
  });

  assertEquals(
    adapterHandle.name,
    "My Web Server",
    "adapter advertise().name should be the instance name",
  );
  assertEquals(
    adapterHandle.fullName,
    expectedFullName,
    "adapter advertise().fullName should be the FQN, not the bare name",
  );

  // The transport path derives the FQN itself; the adapter path must agree.
  const bus = new VirtualBus();
  const transportDnsSd = createDnsSd({
    transport: bus.createTransport(),
    timing: FAST_TIMING,
  });
  const transportHandle = await transportDnsSd.advertise({
    service: advertiseSpec,
  });

  try {
    assertEquals(
      adapterHandle.fullName,
      transportHandle.fullName,
      "adapter and transport advertise().fullName must match for the same input",
    );
  } finally {
    await adapterHandle.stop();
    await transportHandle.stop();
    await transportDnsSd.close();
  }
});

test("adapter browse surfaces a browseStart rejection to the consumer", async () => {
  const failure = new Error("permission denied");
  const adapter: DnsSdAdapter = {
    browseStart(
      _spec: BrowseServiceSpec,
      _sink: ServiceSink,
    ): Promise<AdapterBrowseHandle> {
      return Promise.reject(failure);
    },
    advertiseStart(): Promise<AdapterAdvertiseHandle> {
      throw new Error("not used");
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };

  const dnsSd = dnsSdOverAdapter(adapter);
  const gen = dnsSd.browse({ service });

  await assertThrows(
    () => gen.next(),
    (err) => err === failure,
    "browse-start rejection must surface to the generator consumer",
  );
});
