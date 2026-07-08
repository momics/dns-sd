# @momics/dns-sd-shared

The shared, **runtime-agnostic** foundation for the `@momics/dns-sd` library
family. Pure TypeScript, **zero native or runtime-specific dependencies**, and no
I/O of its own.

> **Most users don't install this directly.** Pick the package for your runtime —
> [`@momics/dns-sd-node`](../dns-sd-node), [`@momics/dns-sd-deno`](../dns-sd-deno),
> or [`@momics/dns-sd-tauri`](../dns-sd-tauri) — and get the same
> `browse` / `advertise` / `close` API. Reach for this package only when you're
> **writing a new runtime backend**.

It contains:

- the **public API types** and the `createDnsSd` factory;
- a hardened, standards-compliant **DNS/mDNS wire codec** (RFC 1035 / 6762 / 6763);
- the runtime-agnostic **mDNS engine** — query scheduling & back-off, a record
  cache with TTL expiry and cache-flush handling, known-answer suppression, and
  the full advertise probe → announce → conflict-resolution → goodbye lifecycle;
- two **backend seams**, `DatagramTransport` (raw UDP) and `DnsSdAdapter` (OS
  resolver), plus an in-memory loopback transport and a shared **conformance
  suite** for testing them.

## Writing a backend

A runtime package implements **one** of the two backend seams and passes it to
`createDnsSd`:

```typescript no-check
import { createDnsSd } from "@momics/dns-sd-shared";

// Runtime with raw UDP multicast (Node, Deno):
const dnsSd = createDnsSd({ transport: myDatagramTransport });

// Runtime that must defer to the OS resolver (Tauri, mobile):
const dnsSd = createDnsSd({ adapter: myDnsSdAdapter });

for await (const svc of dnsSd.browse({ service: { type: "http", protocol: "tcp" } })) {
  // svc.kind is "found" | "resolved" | "updated" | "removed"
}
```

The seam interfaces (`DatagramTransport` / `DnsSdAdapter`), how each runtime
plugs in, and the conformance suite are documented in
[docs/architecture.md](../../docs/architecture.md). Every runtime package runs
the shared conformance suite against its backend to prove identical behaviour;
the `@momics/dns-sd-shared/testing` entry point also exports `VirtualBus` and
`LoopbackTransport` for testing the engine with no network at all.

## Testing this package

```bash
deno task test    # Deno
npm run test:node # Node.js (tsc build + run)
```

## License

Dual-licensed under MIT or Apache-2.0, at your option.
