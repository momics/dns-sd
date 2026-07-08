# API design principles

The public API is the most valuable and most permanent thing in this repository.
It is **frozen** (see [`AGENTS.md`](../AGENTS.md) §3) and captured as a golden
snapshot in [`../packages/dns-sd-shared/api/`](../packages/dns-sd-shared/api/).
This document is the standard the surface is held to — "WHATWG-level": small,
orthogonal, predictable, and indistinguishable from something the platform could
have shipped.

## The shape we keep

The entire user-facing surface is two verbs and a teardown:

```ts
const handle = await advertise({ service: { type, protocol, name, port, txt } });
for await (const event of browse({ service: { type, protocol } })) { … }
await close();
```

Everything below is in service of keeping it that simple.

## Principles

1. **Small, orthogonal primitives.** `browse` and `advertise` are symmetric and
   independent. There is no third verb that is a combination of the two, and no
   option that only makes sense in one obscure pairing. If two features are
   really one, merge them; if one option only matters with another, reconsider
   both.

2. **Mirror the platform, don't invent idioms.** Use what web and modern JS
   already standardised so users bring zero new mental model:
   - **Async iterators** for streams of events (`browse` is an
     `AsyncGenerator` of lifecycle events), not callbacks or an `EventEmitter`.
   - **`AbortSignal`** (`opts.signal`) for cancellation — the same primitive as
     `fetch`. Never invent a bespoke cancel token.
   - **Options objects** with named fields, not long positional argument lists.
   - **`Uint8Array`** for bytes, not `Buffer` (which is Node-only).

3. **No options-bag creep.** Every field on `BrowseOpts` / `AdvertiseOpts` /
   `ServiceSpec` must earn its place. The bar: *is it impossible or genuinely
   awkward to express this without a first-class option?* Timing, retries,
   buffer sizes and similar tuning belong behind the engine seam, not on the
   public verb. When in doubt, leave it out — you can always add later, but you
   can never remove.

4. **Make illegal states unrepresentable.** Prefer discriminated unions over
   boolean flags and optional fields that are only sometimes meaningful. The
   `ServiceAnnouncement` union is the model: `found` has `host: null` and
   `port: null` *in the type*; `resolved` guarantees them non-null. The compiler,
   not the docs, tells the user what is available when.

5. **Symmetry and least surprise.** Inputs and outputs mirror each other
   (`TxtRecordsInput` accepts strings for convenience; `TxtRecords` returns the
   precise decoded forms). The same concept has the same name everywhere across
   all runtime packages — they re-export one identical API.

6. **Total functions and honest types.** No `any`. No lying return types.
   "Best-effort" fields (like resolved `addresses`) are typed and documented as
   such rather than pretending to a guarantee the network can't make.

7. **Zero required configuration.** The common case works with the minimum
   input. Defaults are sensible and standards-compliant (`domain: "local"`,
   `protocol: "tcp"` where natural). Advanced seams exist for runtime authors,
   not end users, and are documented as such.

## Definition of done for an API change

An API change is only acceptable when **all** hold:

- It is expressible as a diff to the golden snapshot that a human deliberately
  approved (`deno task check:api` failing is the trigger to *stop and decide*,
  not to auto-`snapshot:api`).
- It is documented with JSDoc that passes `deno task check:docs`.
- It preserves the two-verb shape and the principles above.
- It has a `CHANGELOG.md` entry and, post-1.0, a semver-appropriate bump.
- It reads like it could have shipped with the platform.

If a change can't meet that bar, it belongs behind a seam or not at all.
