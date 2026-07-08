/**
 * Type-level tests that lock the *type behavior* of the public API of
 * `@momics/dns-sd-shared`. These assertions are checked by the existing
 * typecheck gate — `deno task check` (Deno) and `tsc --noEmit` (Node) — and
 * have zero runtime cost: the module contains no executable assertions beyond a
 * single no-op harness registration.
 *
 * The goal is to catch *type* regressions the runtime suite cannot see: if a
 * refinement on the {@link ServiceAnnouncement} union is widened, an option is
 * dropped from {@link BrowseOpts}/{@link AdvertiseOpts}, or the `browse` return
 * type drifts, one of the `Expect<Equal<…>>` rows below fails to compile.
 *
 * Assertions are dependency-free (no `tsd`/`expect-type`): a local `Equal`
 * helper plus `// @ts-expect-error` for illegal usage, per the zero-dependency
 * policy in `AGENTS.md`.
 *
 * @module
 */

import { test } from "../src/testing/harness.ts";
import type {
  AdvertiseOpts,
  BrowseOpts,
  DnsSd,
  ServiceAnnouncement,
  ServiceFound,
  ServiceRemoved,
  ServiceResolved,
  ServiceUpdated,
  TxtRecords,
  TxtRecordsInput,
} from "../src/index.ts";

// ── Type-level assertion helpers (dependency-free) ──────────────────────────

/**
 * Exact type equality. Resolves to `true` only when `A` and `B` are mutually
 * assignable *and* identical (the function-wrapper trick distinguishes e.g.
 * `string` from `string | null`, which a bare `extends` check would not).
 */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

/** Compile-time assertion that a {@link Equal} (or other) check resolved `true`. */
export type Expect<T extends true> = T;

/** True iff `A` is assignable to `B`. */
export type Extends<A, B> = A extends B ? true : false;

// ── ServiceAnnouncement: per-variant field refinements ──────────────────────

/**
 * Each row must resolve to `true`; a widened refinement (e.g. `host: string`
 * becoming `string | null` on `ServiceResolved`) turns the row `false` and
 * fails `Expect<false>` to compile.
 */
export type _ServiceAnnouncementRefinements = [
  // `found` is unresolved: host/port null, addresses the empty tuple.
  Expect<Equal<ServiceFound["kind"], "found">>,
  Expect<Equal<ServiceFound["host"], null>>,
  Expect<Equal<ServiceFound["port"], null>>,
  Expect<Equal<ServiceFound["addresses"], []>>,
  Expect<Equal<ServiceFound["isActive"], true>>,

  // `resolved` guarantees non-null host/port; addresses is best-effort.
  Expect<Equal<ServiceResolved["kind"], "resolved">>,
  Expect<Equal<ServiceResolved["host"], string>>,
  Expect<Equal<ServiceResolved["port"], number>>,
  Expect<Equal<ServiceResolved["addresses"], string[]>>,
  Expect<Equal<ServiceResolved["isActive"], true>>,

  // `updated` carries the same non-null guarantee as `resolved`.
  Expect<Equal<ServiceUpdated["kind"], "updated">>,
  Expect<Equal<ServiceUpdated["host"], string>>,
  Expect<Equal<ServiceUpdated["port"], number>>,
  Expect<Equal<ServiceUpdated["addresses"], string[]>>,
  Expect<Equal<ServiceUpdated["isActive"], true>>,

  // `removed` is a teardown: host/port informational (nullable), inactive.
  Expect<Equal<ServiceRemoved["kind"], "removed">>,
  Expect<Equal<ServiceRemoved["host"], string | null>>,
  Expect<Equal<ServiceRemoved["port"], number | null>>,
  Expect<Equal<ServiceRemoved["addresses"], string[]>>,
  Expect<Equal<ServiceRemoved["isActive"], false>>,

  // The union is exactly the four variants.
  Expect<
    Equal<
      ServiceAnnouncement,
      ServiceFound | ServiceResolved | ServiceUpdated | ServiceRemoved
    >
  >,
];

/**
 * Narrowing on `kind` yields the precise variant type, so consumers may rely on
 * `host`/`port` being non-null after a `resolved`/`updated` narrow. Never
 * invoked; the body exists only to be type-checked.
 */
export function _narrowingOnKind(ann: ServiceAnnouncement): void {
  switch (ann.kind) {
    case "found": {
      const _found: ServiceFound = ann;
      // @ts-expect-error `found.host` is `null`, not a string.
      const _host: string = ann.host;
      void _found;
      void _host;
      break;
    }
    case "resolved": {
      const _resolved: ServiceResolved = ann;
      // Non-null host/port are available after narrowing.
      const _host: string = ann.host;
      const _port: number = ann.port;
      void _resolved;
      void _host;
      void _port;
      break;
    }
    case "updated": {
      const _updated: ServiceUpdated = ann;
      const _host: string = ann.host;
      const _port: number = ann.port;
      void _updated;
      void _host;
      void _port;
      break;
    }
    case "removed": {
      const _removed: ServiceRemoved = ann;
      // @ts-expect-error `removed.host` may be `null`, so it is not a `string`.
      const _host: string = ann.host;
      void _removed;
      void _host;
      break;
    }
  }
}

// ── browse(): return type & options ─────────────────────────────────────────

/** The public `browse` yields the declared async generator of announcements. */
export type _BrowseReturn = Expect<
  Equal<
    ReturnType<DnsSd["browse"]>,
    AsyncGenerator<ServiceAnnouncement, void, void>
  >
>;

/** `BrowseOpts`/`AdvertiseOpts` accept the platform cancellation primitives. */
export type _OptsSignals = [
  Expect<Equal<BrowseOpts["signal"], AbortSignal | undefined>>,
  Expect<Equal<BrowseOpts["timeoutMs"], number | undefined>>,
  Expect<Equal<AdvertiseOpts["signal"], AbortSignal | undefined>>,
];

/**
 * Options-object shape checks that need value-level context (illegal fields,
 * required `service`). Never invoked.
 */
export function _optsUsage(): void {
  const _browse: BrowseOpts = {
    service: { type: "http", protocol: "tcp" },
    signal: new AbortController().signal,
    timeoutMs: 1000,
  };
  void _browse;

  // @ts-expect-error `service` is required on BrowseOpts.
  const _missingService: BrowseOpts = { timeoutMs: 1000 };
  void _missingService;

  const _badTimeout: BrowseOpts = {
    service: { type: "http", protocol: "tcp" },
    // @ts-expect-error `timeoutMs` must be a number, not a string.
    timeoutMs: "soon",
  };
  void _badTimeout;

  const _advertise: AdvertiseOpts = {
    service: { name: "My Server", type: "http", protocol: "tcp", port: 80 },
    signal: new AbortController().signal,
  };
  void _advertise;

  const _advTimeout: AdvertiseOpts = {
    service: { name: "My Server", type: "http", protocol: "tcp", port: 80 },
    // @ts-expect-error `advertise` has no `timeoutMs` field (not in the surface).
    timeoutMs: 1000,
  };
  void _advTimeout;
}

// ── TXT: input accepts strings; output is the decoded forms ─────────────────

/**
 * `TxtRecordsInput` accepts `string` values for convenience while `TxtRecords`
 * returns only the decoded `Uint8Array | true | null` forms.
 */
export type _TxtInputVsOutput = [
  // Input value union includes `string`; output value union does not.
  Expect<Extends<string, TxtRecordsInput[string]>>,
  Expect<Equal<TxtRecordsInput[string], string | Uint8Array | true | null>>,
  Expect<Equal<TxtRecords[string], Uint8Array | true | null>>,
];

/** Value-level asymmetry: strings are accepted on input, rejected on output. */
export function _txtUsage(): void {
  const _input: TxtRecordsInput = {
    path: "/api",
    bytes: new Uint8Array([1, 2, 3]),
    present: true,
    empty: null,
  };
  void _input;

  const _output: TxtRecords = {
    bytes: new Uint8Array([1, 2, 3]),
    present: true,
    empty: null,
  };
  void _output;

  // @ts-expect-error decoded TXT records never contain plain strings.
  const _badOutput: TxtRecords = { path: "/api" };
  void _badOutput;
}

// A single trivial runtime registration so the suite reports this file; the
// assertions above are entirely compile-time.
test("api type-level assertions compile", () => {});
