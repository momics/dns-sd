# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the packages in this workspace adhere to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every package
(`@momics/dns-sd-shared`, `@momics/dns-sd-node`, `@momics/dns-sd-deno`,
`@momics/dns-sd-tauri` / the `tauri-plugin-dns-sd` crate) is released together
under a single version tag — see [CONTRIBUTING.md](./CONTRIBUTING.md#releasing).

## [Unreleased]

Pre-release hardening following the post-audit review. Nothing has been
published yet; this section becomes the notes for the first tagged release.

### Added

- **Performance regression gate (hot paths).** A dependency-free `Deno.bench`
  suite (`packages/dns-sd-shared/bench/`) covering the receive/send hot paths —
  `wire/encode` + `wire/decode` on a representative DNS-SD browse response, the
  record cache (`add` insert/expiry-scheduling and `knownAnswers` scan), and the
  TXT codec — plus a committed baseline (`bench/perf-baseline.json`) and a gate
  (`deno task perf:gate`, `scripts/perf-gate.ts`) wired into a dedicated CI job
  (`.github/workflows/perf.yml`). The gate is hardware-independent (each
  benchmark is normalised against an in-run calibration loop) and deliberately
  coarse (fails only past a generous 4× budget), so it catches real
  order-of-magnitude regressions on noisy shared runners without flaking on
  micro-noise. Time-per-iteration is the tracked metric; per-op allocation
  tracking is deferred until `Deno.bench` exposes it. Re-baseline deliberately
  with `deno task perf:baseline` (#39).
- **Golden wire vectors.** Byte-exact DNS-SD / mDNS packet fixtures
  (`packages/dns-sd-shared/test/fixtures/golden-wire.ts`) asserted by the codec
  (`packages/dns-sd-shared/test/golden-wire.test.ts`) so on-the-wire behaviour
  cannot drift from the ecosystem. Includes a browse query and a full
  announcement (PTR/TXT/SRV/A/AAAA/NSEC) **captured from real Apple Bonjour**
  (`mDNSResponder`) traffic — with personally-identifying leaves replaced by
  same-length placeholders so all framing, compression, TTLs and record order
  are preserved byte-for-byte — plus a spec-derived goodbye (TTL=0, RFC 6762
  §10.1). Every vector is decoded to a committed structure and round-tripped
  under both Deno and Node; the captured announcement and the spec-derived
  goodbye are additionally pinned to their exact bytes (the announcement's
  layout is canonical for this codec), while the captured browse query pins
  meaning rather than exact bytes. Live Avahi captures are left for a human on
  Linux (Avahi was unavailable in the capture environment) (#38).
- **Type-level API tests.** A dependency-free `*.type-test.ts` suite
  (`packages/dns-sd-shared/test/api.type-test.ts`) that locks the *type
  behavior* of the public API — the `ServiceAnnouncement` per-variant
  refinements and `kind` narrowing, `browse()`'s `AsyncGenerator` return type,
  the `signal`/`timeoutMs` options on `BrowseOpts`/`AdvertiseOpts`, and the
  `TxtRecordsInput` (accepts `string`) vs `TxtRecords` (decoded forms only)
  asymmetry. Checked by the existing typecheck gate under both Deno
  (`deno task check`) and Node (`tsc --noEmit`) with zero runtime cost (#42).
- **Mutation-testing ratchet (Stryker).** `npm run test:mutation` runs
  [Stryker](https://stryker-mutator.io/) over the pure-TypeScript core
  (`packages/dns-sd-shared/src/`, excluding the test harness) via the `command`
  test runner against the shared cross-runtime suite. An enforced floor
  (`thresholds.break` in `stryker.conf.json`) fails CI when the mutation score
  regresses; the committed baseline is **65.87%** (anti-flake floor set at
  **63%**). A
  Node-only `Mutation` workflow (`.github/workflows/mutation.yml`) gates every
  push/PR. Proves the tests fail when logic breaks — the highest-leverage guard
  against coverage-gaming (`docs/testing-strategy.md`).
- **Agent-convergence governance.** A constitution (`AGENTS.md`) plus
  `.github/copilot-instructions.md` and `docs/` (`convergence.md`,
  `api-design.md`, `testing-strategy.md`) that define an unambiguous "done", a
  frozen public API, explicit non-goals, and the ratchets that keep the package
  converging.
- **JSDoc completeness gate.** `deno task check:docs` (`deno doc --lint`) fails
  the build if any exported symbol on a public entrypoint lacks documentation;
  every public symbol is now documented.
- **Frozen public-API snapshot gate.** `deno task check:api` diffs the public
  surface against a committed golden snapshot
  (`packages/dns-sd-shared/api/dns-sd-shared.api.md`); `deno task snapshot:api`
  re-baselines it deliberately. Both run in CI.
- **Published bundle-size ratchet.** `size-limit` measures the minified +
  gzipped ESM of each published `@momics/dns-sd-shared` entrypoint (`.`,
  `./wire`, `./testing`, `./testing/harness`) against committed per-entrypoint
  limits in `packages/dns-sd-shared/.size-limit.json`; `npm run size --workspace
  @momics/dns-sd-shared` runs it and a Node-only CI job fails when an entrypoint
  grows past its limit — the "thin, pure-TS, zero native deps" promise, machine-enforced.
- `MdnsBrowser` and `MdnsResponder` — documented public handle interfaces
  returned by `MdnsEngine.browse` / `MdnsEngine.advertise`, replacing the leaked
  internal classes in the engine's public signatures.
- **Cross-runtime interop proof in CI.** A loopback (in-process `VirtualBus`,
  no multicast) advertise→browse interop test that decodes the actual bytes on
  the wire, run under both Deno and Node on every push. The real-multicast
  interop suite (`integration/cross-runtime.test.mjs`) stays manual/on-demand.
- **Mobile compile-only CI checks.** The Tauri plugin is cross-compiled to
  `aarch64-linux-android` (gating) and `aarch64-apple-ios` (informational) so
  mobile build regressions are caught without a device.
- **Release metadata.** `CHANGELOG.md`, a documented release process in
  `CONTRIBUTING.md`, and `keywords` / `engines` on the package manifests.
- Consolidated all TypeScript tests onto one shared, zero-dependency
  cross-runtime harness so a single command per runtime runs the whole suite.
- Property-based codec tests, publish gated on the full CI suite, and
  informational coverage reporting (TS + Rust).

### Fixed

- Decode/encode DNS name labels and TXT keys as UTF-8 (#18).
- Adapter seam parity: `advertise().fullName` is now correct and browse-start
  errors are surfaced instead of swallowed (#31).
- Added the RFC 6762 §6 response-aggregation delay to the responder (#28).
- Validate TXT record keys on advertise per RFC 6763 §6.3 (#27).
- Reject NSEC records with no bitmap types on encode.
- Removed the redundant double-stop of an adapter browse handle.

### Changed

- Unified self-echo suppression into a single shared, pure `EchoSuppressor`
  used by every UDP transport (#30).
- `publish.yml` now also checks `packages/dns-sd-tauri/Cargo.toml` against the
  release tag, so a missed Rust version bump fails the release.

### Known limitations

- QU (unicast-response) queries fall back to multicast responses — the
  transport seam is multicast-only by design.
- The Tauri adapter is single-instance; the Node and Deno runtimes support
  multiple independent instances.

[Unreleased]: https://github.com/momics/dns-sd/commits/main
