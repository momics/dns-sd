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

## Candidate ratchets — the initial roadmap is fully installed

The original gap between "good" and "the attractor" was tracked as six issues —
mutation testing (#37), golden wire vectors (#38), performance baselines (#39),
bundle-size (#40), executable README examples (#41), and type-level tests (#42).
**All six are now installed and enforced in CI**; they live in `AGENTS.md` §5's
ratchet table alongside the original gates. Closing them was the legitimate work
that moved a metric (§1 of `AGENTS.md`); with them landed, the steady state is
now the expectation, not the goal.

Future candidate ratchets are added the same way (the recipe above): a metric, a
committed baseline, a CI gate, and a row in `AGENTS.md` §5 — never an informal
review preference. If no such metric is outstanding, there is nothing to add:
a green build with no ratchet improvable is *done*.

## Why this makes the package "barely need touching"

Once the surface is frozen, the spec is executable, and every regressable
property is ratcheted, there is no legal change left that isn't either a
spec-cited fix or a deliberate, human-approved surface change. Agents run the
oracle, find it green, find no ratchet improvable, and stop. That steady state —
a small, elegant, fully-verified package that resists drift — is the whole point.
