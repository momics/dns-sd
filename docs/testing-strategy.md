# Testing strategy: an executable spec, not coverage theater

"Battle-tested" in this repository has a precise meaning: **behavior is pinned to
an external authority so it cannot silently drift.** Coverage percentage is a
by-product, never the goal. A test that runs a line without asserting anything
observable is worse than no test — it manufactures false confidence and invites
coverage-gaming. See [`convergence.md`](./convergence.md) for why this matters
for agent convergence.

## The layers (from most to least authoritative)

1. **Spec conformance — the ground truth.**
   mDNS / DNS-SD is defined by RFC 1035, RFC 6762 and RFC 6763. Every observable
   MUST/SHOULD is a discrete, named test case that cites its clause, run through
   the shared cross-runtime conformance harness
   (`packages/dns-sd-shared/src/testing/`). These tests answer "does the library
   obey the standard?" — the only definition of correct that a hundred agents
   can agree on. When behavior is in question, the RFC wins and the test
   encodes it.

2. **Golden wire vectors — pin to the ecosystem.**
   The DNS wire codec (`src/wire/`) is exercised against byte-exact fixtures.
   The strongest fixtures are captured from real Bonjour (`mDNSResponder`) and
   Avahi traffic: if we can decode what they emit and they can decode what we
   emit, we are interoperable by construction. *(Roadmap: capture and commit
   these vectors — see `convergence.md`.)*

3. **Property tests — cover the inputs you didn't think of.**
   Roundtrip invariants (`decode(encode(x))` is structurally `x`), and
   never-panic guarantees over arbitrary/hostile byte input, expressed as
   properties rather than examples (`codec.property.test.ts`). The codec must
   *never throw on attacker-controlled bytes* — it must reject them cleanly.

4. **Behavioral / e2e tests over the loopback bus.**
   The engine is driven end-to-end over an in-memory virtual transport
   (`src/testing/loopback.ts`), so browse/advertise lifecycles (`found` →
   `resolved` → `updated` → `removed`, conflict rename, goodbye) are verified
   deterministically without real networking.

5. **Real-network interop — gated, run locally.**
   Advertise from this library and resolve with `avahi-browse` / `dns-sd -B`
   (and vice versa). Gated behind `DNS_SD_NETWORK_TESTS=1`; not in CI because it
   needs a multicast-capable network, but it is the ultimate acceptance test.

## The golden rule: one suite, both runtimes

Every `.test.ts` runs **unchanged** under both Deno and Node via one shared,
zero-dependency harness (`src/testing/harness.ts`). This is itself a ratchet:
runtime-specific behavior can't sneak in, because the same assertions must hold
on both. One command per runtime runs the whole suite:

```bash
deno task test        # whole TS suite under Deno
npm run test:node     # whole TS suite under Node
```

## Rules for writing tests here

- **Assert something observable.** Every test must be able to *fail* for a real
  reason. If mutating the implementation wouldn't break your test, the test is
  worthless — delete or fix it. *(Roadmap: mutation testing makes this
  automatic.)*
- **Fix a bug test-first.** Reproduce the defect as a failing test that cites the
  symptom (and RFC clause if applicable), then make it pass.
- **Name the contract, not the code path.** Test names describe the guaranteed
  behavior ("stopping an advertisement removes it (goodbye)"), so they read as a
  living specification.
- **Prefer the harness over runtime APIs.** Use the shared assertions so the test
  stays cross-runtime.
- **Determinism only.** Use the accelerated timing preset and the loopback bus;
  no wall-clock sleeps, no reliance on real network in CI.

## What "enough testing" means

Not a coverage number. Enough is: every RFC MUST is conformance-tested, the
codec has roundtrip + never-panic properties, every lifecycle transition has a
loopback e2e test, and (roadmap) the mutation score meets its committed floor.
When those hold and the oracle is green, the suite is done — adding assertion-free
tests to chase a percentage is churn (`AGENTS.md` §1).
