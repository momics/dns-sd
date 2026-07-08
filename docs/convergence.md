# Convergence: how hundreds of agents land on the same fixed point

This document explains the *why* behind [`AGENTS.md`](../AGENTS.md). If
`AGENTS.md` is the law, this is the theory of the law.

## The problem

A thin-scoped library is easy to write and hard to *stabilise*. Point a hundred
capable agents at it and, absent constraints, they will each "improve" it in a
hundred incompatible directions: renaming for taste, adding options nobody asked
for, refactoring stable code, writing tests that pass but assert nothing. The
package never settles. Activity is mistaken for progress.

## The idea: convergence = shrinking the space of legal changes

Agents diverge when "correct" is subjective. They converge when the definition
of correct is **executable** and the surface is **frozen**. So the whole
strategy is: *move good taste out of human review and into machine-checkable
constraints*, until the only changes that remain legal are the ones that make
the package objectively better — and there are eventually none left.

Formally, we want the repository to be an **attractor**: a state where

```
build is green  ∧  no ratchet can be improved  ⇒  done
```

Every agent that starts elsewhere is pulled toward this state and, once there,
has nothing left to do. That "nothing left to do" is the goal, not a failure.

## The three mechanisms

### 1. A constitution (`AGENTS.md`) — removes ambiguity

A short, absolute set of non-negotiables every agent reads first: the oracle
that defines "done", the frozen surface, the written-down non-goals, and the
rule that taste is delegated to the formatter. Ambiguity is what lets agents
diverge; the constitution deletes it.

### 2. An executable spec — the ground truth they converge *to*

"Battle-tested" is not high coverage; it is behavior pinned to an external
authority so it cannot drift. See [`testing-strategy.md`](./testing-strategy.md).
The spec (RFC-cited conformance tests, golden wire vectors, property tests) is
the shape of the attractor: agents move code until it matches the spec, and the
spec doesn't move on a whim.

### 3. Monotonic ratchets — the anti-drift teeth

Every property that can silently regress gets a floor enforced in CI that only
moves in the good direction: the API snapshot, JSDoc completeness, types,
format/lint, cross-runtime tests. An agent can only merge if it holds or
improves every ratchet. Because the ratchets never loosen, the *population* of
agents can only push the package monotonically toward the fixed point.

```
        (worse) ───────────────► (better)
   agent A ─┐                        │
   agent B ─┼──►  ratchets only  ──► ▓ fixed point: green + nothing improvable
   agent C ─┘     allow forward       │
```

## How to add a ratchet (the only sanctioned way to raise the bar)

A ratchet is not a review opinion; it is a mechanism. To add one:

1. **Pick a metric** that is objective and cheaply measured
   (e.g. mutation score, bundle bytes, a benchmark threshold, allocation count).
2. **Commit a baseline** to the repo (a golden file or a number).
3. **Add a CI gate** that fails when the metric regresses past the baseline, and
   a task to re-baseline deliberately (`snapshot:*`).
4. **Document it** in `AGENTS.md` §5's table and here.

Never enforce a new expectation informally in review — encode it or drop it.

## Candidate ratchets not yet installed (the roadmap to the fixed point)

These are the known gaps between "good" and "the attractor". Closing them is the
legitimate work that moves a metric (§1 of `AGENTS.md`). Each is tracked as an
issue:

- **Mutation testing** (e.g. Stryker on `dns-sd-shared`) — the highest-leverage
  addition: proves the tests fail when logic breaks, which is what actually
  stops coverage-gaming. ([#37](https://github.com/momics/dns-sd/issues/37))
- **Golden wire vectors** captured from real Bonjour (`mDNSResponder`) and Avahi
  traffic, asserted by the codec so behavior can't drift from the ecosystem.
  ([#38](https://github.com/momics/dns-sd/issues/38))
- **Performance baselines** on the hot paths (encode/decode, cache) with a
  regression gate — track allocations, not just wall-clock.
  ([#39](https://github.com/momics/dns-sd/issues/39))
- **Bundle-size ratchet** (e.g. `size-limit`) on the published entrypoints.
  ([#40](https://github.com/momics/dns-sd/issues/40))
- **Executable README examples** — extract and typecheck/run every code block so
  docs can't rot. ([#41](https://github.com/momics/dns-sd/issues/41))
- **Type-level tests** (`tsd`/`expect-type`) so the *shape* of the API is under
  test, not just its runtime behavior.
  ([#42](https://github.com/momics/dns-sd/issues/42))

When one is installed, move it up into `AGENTS.md` §5 and delete it here.

## Why this makes the package "barely need touching"

Once the surface is frozen, the spec is executable, and every regressable
property is ratcheted, there is no legal change left that isn't either a
spec-cited fix or a deliberate, human-approved surface change. Agents run the
oracle, find it green, find no ratchet improvable, and stop. That steady state —
a small, elegant, fully-verified package that resists drift — is the whole point.
