/**
 * A shared conformance suite. Each runtime package (Deno, Node, Tauri) imports
 * these cases and runs them against a {@link ConformanceHarness} built on its
 * own backend, proving identical `browse` / `advertise` behaviour everywhere.
 *
 * The cases are runner-agnostic: they are plain `{ name, run }` objects that
 * throw on failure. Wire them into whatever test runner the package uses.
 *
 * @example
 * ```ts
 * import { conformanceCases } from "@momics/dns-sd-shared/testing";
 * for (const c of conformanceCases()) {
 *   Deno.test(c.name, () => c.run(makeHarness()));
 * }
 * ```
 *
 * @module
 */

import type { DnsSd, ServiceAnnouncement } from "../types.ts";

/**
 * Supplies fresh, mutually-discoverable {@link DnsSd} nodes for one test. Each
 * `run` receives its own harness on an isolated discovery segment; `cleanup`
 * is invoked afterwards regardless of outcome.
 */
export interface ConformanceHarness {
  /** Create a new node that shares a discovery segment with this harness's other nodes. */
  createNode(): DnsSd;
  /** Tear down every node created by this harness. */
  cleanup(): Promise<void>;
}

/** A single conformance test case. */
export interface ConformanceCase {
  /** A stable, human-readable name. */
  name: string;
  /** Run the case; throw to fail. */
  run(harness: ConformanceHarness): Promise<void>;
}

const SERVICE = { type: "http", protocol: "tcp" } as const;

/** Assertion helper used throughout the suite. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`conformance assertion failed: ${message}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Consumes a browse generator in the background, accumulating events so a test
 * can await conditions across multiple phases without closing the stream.
 */
class Collector {
  readonly events: ServiceAnnouncement[] = [];
  private readonly gen: AsyncGenerator<ServiceAnnouncement, void, void>;
  private done = false;

  constructor(gen: AsyncGenerator<ServiceAnnouncement, void, void>) {
    this.gen = gen;
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const event of this.gen) this.events.push(event);
    } catch {
      // Stream errors surface via timeouts in waitFor.
    }
    this.done = true;
  }

  /** Wait until `predicate` holds over the collected events, or time out. */
  async waitFor(
    predicate: (events: ServiceAnnouncement[]) => boolean,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate(this.events)) return;
      if (this.done) break;
      await sleep(5);
    }
    if (!predicate(this.events)) {
      throw new Error(
        `conformance assertion failed: condition not met within ${timeoutMs}ms`,
      );
    }
  }

  async stop(): Promise<void> {
    // Fire-and-forget: the generator is likely suspended awaiting the next
    // datagram, so its cleanup only completes once the underlying node/FIFO is
    // closed (via the harness cleanup). Don't await it here or we'd deadlock.
    void this.gen.return().catch(() => {});
    await sleep(0);
  }
}

const TIMEOUT = 5000;

/** Build the full set of conformance cases. */
export function conformanceCases(): ConformanceCase[] {
  return [
    {
      name: "browse discovers an advertised service (found → resolved)",
      async run(h) {
        const advertiser = h.createNode();
        const browser = h.createNode();
        await advertiser.advertise({
          service: { ...SERVICE, name: "Conformance A", port: 8080 },
        });
        const c = new Collector(browser.browse({ service: SERVICE }));
        try {
          await c.waitFor(
            (evs) => evs.some((e) => e.kind === "resolved"),
            TIMEOUT,
          );
          const resolved = c.events.find((e) => e.kind === "resolved");
          assert(resolved, "expected a resolved event");
          assert(resolved.name === "Conformance A", "instance name mismatch");
          assert(resolved.port === 8080, "port mismatch");
          assert(resolved.host !== null, "resolved host should be known");
          assert(
            resolved.addresses.length > 0,
            "expected at least one address",
          );
          assert(
            c.events.some((e) => e.kind === "found"),
            "expected a found event before resolved",
          );
        } finally {
          await c.stop();
        }
      },
    },
    {
      name: "TXT attributes round-trip through discovery",
      async run(h) {
        const advertiser = h.createNode();
        const browser = h.createNode();
        await advertiser.advertise({
          service: {
            ...SERVICE,
            name: "TXT Service",
            port: 9,
            txt: { path: "/api", secure: true, empty: null },
          },
        });
        const c = new Collector(browser.browse({ service: SERVICE }));
        try {
          await c.waitFor(
            (evs) => evs.some((e) => e.kind === "resolved"),
            TIMEOUT,
          );
          const resolved = c.events.find((e) => e.kind === "resolved");
          assert(resolved, "expected a resolved event");
          const path = resolved.txt["path"];
          assert(
            path instanceof Uint8Array &&
              new TextDecoder().decode(path) === "/api",
            "txt path should decode to /api",
          );
          assert(
            resolved.txt["secure"] === true,
            "txt secure should be boolean true",
          );
          assert(resolved.txt["empty"] === null, "txt empty should be null");
        } finally {
          await c.stop();
        }
      },
    },
    {
      name: "stopping an advertisement removes it (goodbye)",
      async run(h) {
        const advertiser = h.createNode();
        const browser = h.createNode();
        const handle = await advertiser.advertise({
          service: { ...SERVICE, name: "Ephemeral", port: 1234 },
        });
        const c = new Collector(browser.browse({ service: SERVICE }));
        try {
          await c.waitFor(
            (evs) => evs.some((e) => e.kind === "resolved"),
            TIMEOUT,
          );
          await handle.stop();
          await c.waitFor(
            (evs) => evs.some((e) => e.kind === "removed"),
            TIMEOUT,
          );
          const removed = c.events.find((e) => e.kind === "removed");
          assert(removed, "expected a removed event after goodbye");
          assert(
            removed.isActive === false,
            "removed event should be inactive",
          );
        } finally {
          await c.stop();
        }
      },
    },
    {
      name:
        "two advertisers with the same name are both discovered (conflict rename)",
      async run(h) {
        const a = h.createNode();
        const b = h.createNode();
        const browser = h.createNode();
        const h1 = await a.advertise({
          service: { ...SERVICE, name: "Duplicate", port: 1 },
        });
        const h2 = await b.advertise({
          service: { ...SERVICE, name: "Duplicate", port: 2 },
        });
        assert(
          h1.name !== h2.name,
          `names must differ after conflict resolution, both were "${h1.name}"`,
        );
        const c = new Collector(browser.browse({ service: SERVICE }));
        try {
          await c.waitFor((evs) => {
            const names = new Set<string>();
            for (const e of evs) if (e.kind === "resolved") names.add(e.name);
            return names.size >= 2;
          }, TIMEOUT);
        } finally {
          await c.stop();
        }
      },
    },
    {
      name: "browse respects timeoutMs and ends the generator",
      async run(h) {
        const browser = h.createNode();
        const start = Date.now();
        const gen = browser.browse({ service: SERVICE, timeoutMs: 150 });
        for await (const _ of gen) { /* drain */ }
        assert(
          Date.now() - start < TIMEOUT,
          "browse generator should end well before the hard timeout",
        );
      },
    },
  ];
}
