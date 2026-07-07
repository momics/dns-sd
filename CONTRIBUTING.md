# Contributing to @momics/dns-sd

Thanks for your interest in contributing! This repository is a dual
**Deno + npm** workspace containing the shared DNS-SD foundation
(`@momics/dns-sd-shared`) and the per-runtime packages built on it:
`@momics/dns-sd-node`, `@momics/dns-sd-deno`, and `@momics/dns-sd-tauri`
(which also includes a Rust plugin crate).

## Prerequisites

- [Deno](https://deno.com/) 2.x
- [Node.js](https://nodejs.org/) 24+
- npm 10+
- [Rust](https://www.rust-lang.org/) (stable) — only for the Tauri plugin

## Getting started

```bash
git clone https://github.com/momics/dns-sd
cd dns-sd
npm ci
```

## The golden rule: it must pass under BOTH runtimes

Every TypeScript package registers, asserts and reports through **one shared,
zero-dependency cross-runtime harness**
(`packages/dns-sd-shared/src/testing/harness.ts`, published as
`@momics/dns-sd-shared/testing/harness`). The same `.test.ts` files run
unchanged under both runtimes, so a **single command per runtime** runs the
whole TypeScript suite with identical output:

```bash
deno task test        # whole TS suite under Deno  (shared + dns-sd-deno + tauri)
npm run test:node     # whole TS suite under Node   (shared + dns-sd-node + tauri)
```

Before opening a PR, run the full check locally:

```bash
# Deno
deno fmt --check
deno lint
deno task check                # typecheck shared (source + tests)
deno task check:deno-runtime   # typecheck the Deno runtime package
deno task check:tauri          # typecheck the Tauri guest-js binding
deno task test                 # whole TS suite under Deno

# Node.js
npm run typecheck    # tsc --noEmit across all workspaces
npm run build        # build all TS packages
npm run test:node    # tsc build + whole TS suite under Node

# Tauri plugin (Rust, desktop only)
cd packages/dns-sd-tauri && cargo clippy --all-targets && cargo test
```

All of the above must be green. Real-network and cross-runtime interop tests
are gated behind `DNS_SD_NETWORK_TESTS=1` and are run locally, not in CI.

## Test-driven workflow (add a failing harness test, then fix)

There is exactly **one** way to write a TypeScript test: import `test` and the
`assert*` helpers from the shared harness and register your case. Do not reach
for `node:test`, `Deno.test`, `@std/assert` or any third-party runner — the
harness is intentionally tiny and unifies registration, assertions and
reporting everywhere.

Every change is test-driven:

1. **Add a failing test first.** Put it next to the code it covers, in a
   `*.test.ts` file wired into that package's `run.ts` entry, and import the
   harness:

   ```ts
   import { assert, assertEquals, test } from "@momics/dns-sd-shared/testing/harness";

   test("describes the behaviour you want", () => {
     assertEquals(subject(), expected);
   });
   ```

   Run the suite for your runtime (`deno task test` or `npm run test:node`) and
   watch it **fail** — this proves the test exercises the gap.

2. **Make it pass** with the smallest change that satisfies the test, then
   re-run until green under **both** runtimes.

Notes:

- Runtime-specific tests may still import their own runtime APIs (`node:dgram`,
  `Deno.*`) — the harness only unifies registration/assertions/reporting, not
  the runtime. Keep such a file in the package that owns that runtime.
- Behaviour every runtime must share belongs in `conformanceCases()`
  (`@momics/dns-sd-shared/testing`); each runtime package runs those cases
  against its own transport.
- Assertions: `assert` (truthy), `assertEquals` (`Object.is`),
  `assertDeepEquals` (structural), `assertBytesEqual`, `assertThrows`. Register
  a network-gated case with `test(name, fn, { ignore: !enabled })` so both
  runtimes report the same skipped cases.

## Code style

- **TypeScript strict mode** (plus `noUncheckedIndexedAccess`). No `any` escapes.
- Formatting and linting are enforced by `deno fmt` and `deno lint`. Run
  `deno fmt` to auto-format.
- Source files use `.ts` import extensions; the Node build rewrites these to
  `.js` via `tsc` (`rewriteRelativeImportExtensions`). Keep imports relative and
  extensioned.
- Comment only what needs clarifying — prefer clear names and small functions.

## Guidelines

- **Standards first.** Changes to the wire codec or engine must stay compliant
  with RFC 1035 / 6762 / 6763. Cite the relevant section in comments where it
  aids review.
- **Harden inputs.** The decoder must never read out of range or hang on
  malformed/hostile packets. Add a fuzz/bounds test for any new parsing path.
- **Test behaviour, not implementation.** Prefer end-to-end tests over the
  in-memory loopback transport, and add a `conformanceCases()` entry when you
  add behaviour every runtime must share.
- **No native dependencies** in `@momics/dns-sd-shared`. Runtime-specific code
  belongs in a runtime package behind the `DatagramTransport` or `DnsSdAdapter`
  seam.

## Commit messages & PRs

- Keep PRs focused and describe the "why".
- Ensure CI is green.
- By contributing you agree your work is dual-licensed under MIT and Apache-2.0.

## License

Dual-licensed under MIT ([LICENSE-MIT](./LICENSE-MIT)) or Apache-2.0
([LICENSE-APACHE](./LICENSE-APACHE)), at your option.
