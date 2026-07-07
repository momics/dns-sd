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
