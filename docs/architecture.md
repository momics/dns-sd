# Architecture

How `@momics/dns-sd` is put together. You do **not** need any of this to *use*
the library — see the [root README](../README.md) and the per-package READMEs
for installation and usage. This document is for contributors and for anyone
writing a new runtime backend.

## One engine, thin runtime backends

The mDNS / DNS-SD protocol is implemented **once**, in the runtime-agnostic
[`@momics/dns-sd-shared`](../packages/dns-sd-shared) package: a hardened wire
codec (RFC 1035 / 6762 / 6763) plus the full engine — query scheduling and
back-off, a TTL record cache with cache-flush handling, known-answer
suppression, and the advertise probe → announce → conflict-resolution → goodbye
lifecycle. It is pure TypeScript, has zero native or runtime-specific
dependencies, and performs **no I/O of its own**.

Each runtime package is a **thin backend** that gives the shared engine a way to
talk to the network, and re-exports the identical public API
(`browse` / `advertise` / `close`). Callers get the same behaviour everywhere;
only the import and the initial setup differ.

```
        ┌─────────────────────────────────────────────┐
        │   @momics/dns-sd-shared  (pure TypeScript)   │
        │   wire codec · engine · cache · lifecycle    │
        └───────────────┬──────────────┬──────────────┘
              implements │              │ implements
           DatagramTransport         DnsSdAdapter
                        │              │
        ┌───────────────┴───┐    ┌─────┴───────────────┐
        │ dns-sd-node (dgram)│    │ dns-sd-tauri        │
        │ dns-sd-deno (Deno) │    │  → Rust/native plugin│
        └────────────────────┘    └─────────────────────┘
```

## The two backend seams

A runtime package implements **one** of two interfaces and passes it to
`createDnsSd`.

### `DatagramTransport` — raw UDP multicast (Node, Deno)

The runtime provides a UDP multicast socket; the **shared engine speaks mDNS
itself** over it. This is the path used by the Node.js and Deno runtimes, and
the one to implement for any other raw-socket runtime.

```typescript
interface DatagramTransport {
  readonly family: "IPv4" | "IPv6";
  readonly hostname: string;
  send(data: Uint8Array): Promise<void>;
  receive(): Promise<ReceivedDatagram | null>;
  localAddresses(): string[];
  setMulticastTtl?(ttl: number): void | Promise<void>;
  setMulticastLoopback?(enabled: boolean): void | Promise<void>;
  close(): void | Promise<void>;
}
```

```typescript
const dnsSd = createDnsSd({ transport: myDatagramTransport });
```

### `DnsSdAdapter` — OS resolver (Tauri, mobile)

The runtime delegates to a higher-level DNS-SD provider (the OS resolver or a
native library); the shared engine is **not** used to drive the protocol. The
adapter just maps native browse/advertise events onto the shared
`ServiceAnnouncement` shape through a `sink`.

```typescript
interface DnsSdAdapter {
  browseStart(spec: BrowseServiceSpec, sink: ServiceSink): Promise<AdapterBrowseHandle>;
  advertiseStart(spec: AdvertiseServiceSpec): Promise<AdapterAdvertiseHandle>;
  close(): Promise<void>;
}
```

```typescript
const dnsSd = createDnsSd({ adapter: myDnsSdAdapter });
```

Regardless of which seam a runtime uses, the browse lifecycle (`timeoutMs` /
`AbortSignal`) and the `found → resolved → updated → removed` event model are
owned by the shared layer, so behaviour stays identical across runtimes.

## The Tauri runtime in detail

On iOS and Android you cannot open raw UDP multicast sockets, so discovery
**must** go through the platform resolver. For consistency the desktop path also
delegates — to the [`mdns-sd`](https://crates.io/crates/mdns-sd) crate in the
Rust plugin — rather than driving the shared engine. So the Tauri runtime always
uses the `DnsSdAdapter` seam.

```
guest-js (dns-sd-tauri)             Rust / native plugin
───────────────────────             ────────────────────
browse()  ── DnsSdAdapter ──▶ IPC ──▶ desktop: mdns-sd crate
advertise()                          iOS:     NWBrowser / NWListener
close()                              Android: NsdManager
        ◀── ServiceAnnouncement ◀── native browse/advertise events
```

| Layer            | Location                        | Responsibility                                       |
| ---------------- | ------------------------------- | ---------------------------------------------------- |
| Guest-js adapter | `guest-js/`                     | Implements `DnsSdAdapter`, derives `kind`, TXT codec |
| Rust plugin      | `src/`                          | Commands, models, desktop `mdns-sd` implementation   |
| iOS              | `ios/Sources/DnsSdPlugin.swift` | `NWBrowser` / `NWListener` (Network.framework)       |
| Android          | `android/.../DnsSdPlugin.kt`    | `NsdManager`                                         |
| Example          | `examples/tauri-app/`           | A working browse/advertise demo app                  |

The guest-js binding derives the unified event `kind`
(`found` → `resolved` → `updated` → `removed`) that the public API guarantees,
from each platform's `isActive` + host/port signals. Both `kind` **and**
`isActive` are emitted on every event. Per-platform capabilities and caveats are
documented in the [Tauri README](../packages/dns-sd-tauri/README.md#platform-matrix--limitations).

## Running multiple instances on one host

This matters for local testing and for the conformance suite, which runs many
nodes on a single machine.

The shared engine ignores datagrams whose source address is one of *our own*
addresses (`transport.localAddresses()`). On a real multi-host network this is
correct self-echo suppression. But on a **single host** every node shares the
same source IP, so with real addresses each node would filter its siblings out —
a browse in one process wouldn't see an advertisement from another.

Constructing a transport with **`localAddresses: []`** solves this for
same-host scenarios:

- the engine's IP-based self-filter becomes a no-op, so sibling nodes get
  through;
- the transport still suppresses **its own** socket's echoes directly (it tracks
  recently-sent bytes and drops an exact match), so a node never sees itself;
- `localAddresses()` falls back to loopback (`127.0.0.1` / `::1`) so advertised
  services still carry an A/AAAA record.

On a real network, leave `localAddresses` at its default (the host's real
interface addresses) for correct cross-host records.

## Testing: the conformance suite

Every runtime package runs the **same** shared conformance suite against its own
backend, proving all runtimes behave identically. The cases come from
`@momics/dns-sd-shared/testing`:

```typescript
import { conformanceCases } from "@momics/dns-sd-shared/testing";
import { createDnsSd } from "@momics/dns-sd-shared";

for (const c of conformanceCases()) {
  myTestRunner.test(c.name, () =>
    c.run({
      createNode: () => createDnsSd({ transport: makeMyTransportOnSharedSegment() }),
      cleanup: async () => {/* close nodes */},
    }));
}
```

The `@momics/dns-sd-shared/testing` entry point also exports `VirtualBus` and
`LoopbackTransport` — an in-memory virtual multicast bus that exercises the
engine with no network at all, so the core protocol logic is testable on any CI
runner (including multicast-blocked ones).

Runtimes that use raw sockets additionally run their transport unit tests over
unicast loopback (always safe) and gate the real-multicast conformance run
behind `DNS_SD_NETWORK_TESTS=1`, since many CI environments block multicast.

## See also

- [`docs/api-design.md`](./api-design.md) — the public API design bar.
- [`docs/testing-strategy.md`](./testing-strategy.md) — the testing philosophy.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — build, test, and release workflow.
- [`AGENTS.md`](../AGENTS.md) — the repository constitution and ratchets.
