# AGENTS.md — the constitution for `@momics/dns-sd`

> This file is the contract every contributor — human or AI — works under. It is
> intentionally short and absolute. If a rule here conflicts with a request, the
> rule wins; surface the conflict instead of working around it.

This repository is a **thin-scoped, standards-compliant DNS-SD library**. The
goal is not to grow it — the goal is to converge it to a small, elegant,
battle-tested fixed point and then *stop touching it*. Success looks like a
package that barely needs to change: hundreds of independent agents, given the
same task, all land in the same place because "correct" is machine-checkable and
the surface is frozen.

Read this whole file before making changes.

---

## 1. The Prime Directive: convergence, not activity

Your job is to move the codebase *toward a fixed point*, never to churn it.
Before any change, ask: **does this move a metric the ratchets track, fix a
spec-cited defect, or close a gap in `docs/convergence.md`'s target?** If not,
do not make it. A green build with no ratchet improvable is *done* — there is
nothing left to do, and inventing work is a defect.

## 2. The oracle: "done" is one command

Correctness is not a matter of opinion or review taste. A change is complete
**iff** the full check is green under **both** runtimes:

```bash
# Deno
deno fmt --check && deno lint && deno task check && deno task test
deno task check:docs      # JSDoc completeness (deno doc --lint)
deno task check:api       # public API surface unchanged (or intentionally re-baselined)

# Node
npm run typecheck && npm run build && npm run test:node
```

Never ask a human "is this okay?" for anything the oracle can answer. Run the
oracle. If it is green and no ratchet can be improved, ship it. If it is red,
you are not done.

## 3. The frozen surface

The public API — everything exported from `@momics/dns-sd-shared` and re-exported
by the runtime packages — is a **contract**, captured as a golden snapshot in
[`packages/dns-sd-shared/api/`](./packages/dns-sd-shared/api/).

- **You may not add, rename, remove, or widen a public export** (new function,
  new option field, broader type) without an explicit, human-approved reason.
- Any change to the surface makes `deno task check:api` fail. That failure is a
  **stop sign**, not a chore: re-baseline (`deno task snapshot:api`) only when
  the change was deliberate and belongs in `CHANGELOG.md`.
- Internal refactors that do not touch the snapshot are always welcome.

See `docs/api-design.md` for what "good" looks like here (WHATWG-level: small,
orthogonal primitives, `AbortSignal`, async iterators, no options-bag creep).

## 4. Non-goals (write "no" down so it stays no)

This library will **not**:

- Ship native dependencies or native addons. The core is pure TypeScript.
- Implement DNS beyond what mDNS / DNS-SD (RFC 1035 / 6762 / 6763) requires.
  No unicast DNS resolver, no DNSSEC, no DoH/DoT, no arbitrary record types
  beyond those DNS-SD needs (A, AAAA, PTR, SRV, TXT, NSEC).
- Grow runtime-specific feature flags or configuration knobs "just in case".
  Every option must earn its place against `docs/api-design.md`.
- Add I/O to `@momics/dns-sd-shared`. It stays runtime-agnostic; I/O lives in
  the per-runtime packages behind the `DatagramTransport` / `DnsSdAdapter` seams.
- Depend on a framework, a DI container, or a logging library.

If a task asks for any of the above, stop and say so.

## 5. The ratchets (the anti-drift teeth)

Everything that can silently regress has a floor that only moves in the good
direction, enforced in CI. Never lower a ratchet to make a build pass.

| Ratchet | Enforced by | Rule |
| --- | --- | --- |
| Public API surface | `deno task check:api` | No change without a re-baseline + changelog |
| JSDoc completeness | `deno task check:docs` (`deno doc --lint`) | Every public symbol documented; zero lint errors |
| Type-level API shape | `deno task check` / `npm run typecheck` | Public API type-shape assertions hold (`test/api.type-test.ts`) |
| Types | `tsc --noEmit` (both `strict`) | Zero errors; no new `any` / `@ts-ignore`/`@ts-expect-error` in `src/` |
| Format & lint | `deno fmt --check`, `deno lint` | Zero diffs, zero warnings |
| Cross-runtime tests | `deno task test`, `npm run test:node` | The same suite passes under Deno *and* Node |
| Golden wire vectors | `deno task test` / `npm run test:node` | Real-captured + spec-derived DNS-SD packets decode to the pinned structure (byte-exact for canonical vectors) |
| Mutation score | `npm run test:mutation` (Stryker, nightly + on `main`) | Score stays ≥ the committed floor (`thresholds.break`); ratchet the floor **up** as it improves, never down |
| Performance | `deno task perf:gate` | Hot-path timings stay within budget of `bench/perf-baseline.json`; re-baseline deliberately (`deno task perf:baseline`) |
| Bundle size | `npm run size` (`size-limit`) | Published entrypoints stay under the committed byte limits |
| Executable docs | `deno task check:docs-examples` | Every non-`no-check` README example type-checks against the real public API |

New ratchets are added the way `docs/convergence.md` describes — a metric, a
committed baseline, and a CI gate — never as informal review preference.

## 6. Taste is delegated, not debated

Do not argue style. Formatting is whatever `deno fmt` produces; lint is whatever
`deno lint` accepts. Naming, ordering, and layout follow the existing files.
There is nothing to discuss here — run the formatter and move on. Time spent
"cleaning up" code the formatter already blesses is churn (see §1).

## 7. Documentation is part of the code

- Every exported symbol carries JSDoc. This is enforced (`check:docs`), not
  optional. Match the terse, precise, RFC-citing style already in `src/`.
- The `README.md` of each package is the human contract; keep its code examples
  correct — they are expected to compile against the real API.
- User-visible changes are recorded in `CHANGELOG.md`.
- Prefer improving a JSDoc block or a README over adding prose files.

## 8. Workflow for a change

1. **Read** this file, `docs/convergence.md`, and the relevant `src/` + tests.
2. **Establish baseline**: run the oracle (§2). It must already be green.
3. Make the **smallest change** that fully addresses the task. Add or update
   tests first when fixing a bug — reproduce, then fix.
4. If you touched the public surface, decide deliberately: revert it, or
   re-baseline the snapshot and add a `CHANGELOG.md` entry.
5. **Run the oracle again.** All of it. Both runtimes.
6. Stop. Do not gold-plate. Do not open adjacent scope.

## 9. Agent failure modes this repo actively guards against

| Failure mode | Guard |
| --- | --- |
| Churning style / re-formatting blessed code | `deno fmt`/`deno lint` — nothing to debate (§6) |
| Gaming coverage with assertion-free tests | Spec-cited conformance + property tests (see `docs/testing-strategy.md`) |
| Scope creep / new options | Frozen API + non-goals + `check:api` (§3, §4) |
| Silent behavior drift | Golden wire vectors + API snapshot |
| "Is this okay?" approval loops | The oracle is the only authority (§2) |
| Endless refactoring of a stable surface | The Prime Directive: no metric to move ⇒ stop (§1) |
| Undocumented public code | `check:docs` JSDoc gate (§7) |

---

*If you are an AI agent: you have everything you need to self-verify. Do not ask
for permission the oracle can grant. Converge, verify, stop.*
