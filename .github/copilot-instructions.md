# GitHub Copilot instructions

This repository is governed by a single constitution: **[`AGENTS.md`](../AGENTS.md)**.
Read it in full before proposing or making changes. The essentials:

- **Converge, don't churn.** Only make a change that moves a tracked metric,
  fixes a spec-cited defect, or closes a documented gap. A green build with no
  ratchet improvable is *done*.
- **The oracle decides "done"** — not review taste. A change is complete only
  when the full check is green under **both** Deno and Node:
  - Deno: `deno fmt --check && deno lint && deno task check && deno task test && deno task check:docs && deno task check:api`
  - Node: `npm run typecheck && npm run build && npm run test:node`
- **The public API is frozen.** Do not add, rename, remove, or widen a public
  export. Changing it makes `deno task check:api` fail — that is a stop sign.
- **Respect the non-goals** in `AGENTS.md` §4 (no native deps, no DNS beyond
  mDNS/DNS-SD, no I/O in `-shared`, no config-knob creep).
- **Document every public symbol** — `deno task check:docs` enforces it.
- **Don't debate style** — run `deno fmt`; accept `deno lint`.

Never ask a human for approval that the oracle can grant. Converge, verify, stop.
