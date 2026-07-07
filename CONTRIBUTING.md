# Contributing to @momics/dns-sd

Thanks for your interest in contributing! This repository is a dual
**Deno + npm** workspace containing the shared DNS-SD foundation.

## Prerequisites

- [Deno](https://deno.com/) 2.x
- [Node.js](https://nodejs.org/) 24+
- npm 10+

## Getting started

```bash
git clone https://github.com/momics/dns-sd
cd dns-sd
npm ci
```

## The golden rule: it must pass under BOTH runtimes

The shared package is runtime-neutral, and CI proves it by running the exact
same test suite under Deno **and** Node.js. Before opening a PR, run the full
check locally:

```bash
# Deno
deno fmt --check
deno lint
deno task check      # typecheck source + tests
deno task test       # run the suite

# Node.js
npm run typecheck    # tsc --noEmit
npm run test:node    # tsc build + run the suite
```

All of the above must be green.

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
