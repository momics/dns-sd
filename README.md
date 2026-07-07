# @momics/dns-sd

A professional, fully standards-compliant **DNS-SD** (DNS Service Discovery over
multicast DNS) library family for TypeScript. One simple, identical public API —
`browse` and `advertise` — across every runtime.

> **Status:** this repository currently contains the shared foundation package,
> [`@momics/dns-sd-shared`](./packages/dns-sd-shared). The per-runtime adapter
> packages (Deno, Node.js, Tauri) are built on top of it in separate work.

## What it is

`@momics/dns-sd` lets you discover and advertise services on the local network
using multicast DNS / DNS-SD — the same technology behind Bonjour and Zeroconf.
The heavy lifting (the wire protocol and the mDNS state machine) lives in one
runtime-agnostic package with **zero native dependencies**; each runtime plugs a
thin backend into a well-defined seam and re-exports the identical public API.

## Standards compliance

The shared engine and codec implement:

- **RFC 1035** — base DNS message format, including name-compression pointers.
- **RFC 6762** — Multicast DNS: QU/QM bits, the cache-flush bit, TTL=0
  "goodbye" records, known-answer suppression, and the full
  probing → announcing → conflict-resolution lifecycle.
- **RFC 6763** — DNS-Based Service Discovery: PTR/SRV/TXT/A/AAAA records,
  service-instance enumeration, subtypes, and the
  `_services._dns-sd._udp.local` meta-query.

The decoder is hardened with strict bounds checking so malformed or hostile
packets can never read out of range or hang the process.

## Runtimes

| Runtime         | Discovery mechanism                              | Platforms                         |
| --------------- | ------------------------------------------------ | --------------------------------- |
| **Deno**        | Native UDP multicast, driven by the shared engine | Desktop / server                  |
| **Node.js**     | Native UDP multicast, driven by the shared engine | Desktop / server                  |
| **Tauri**       | OS resolver (Bonjour `NWBrowser` / Android `NsdManager`) | Desktop **and iOS + Android** |

Deno and Node.js speak mDNS directly over a `DatagramTransport`. Tauri — which
must go through the operating system's resolver on mobile — plugs in a
higher-level `DnsSdAdapter` instead. Either way, callers get the exact same
`browse` / `advertise` API.

## Quick start

```typescript
// A runtime package (e.g. @momics/dns-sd-deno) supplies the backend and
// re-exports browse / advertise built on @momics/dns-sd-shared.
import { advertise, browse } from "@momics/dns-sd-deno";

// Advertise a service …
const handle = await advertise({
  service: { type: "http", protocol: "tcp", name: "My Web Server", port: 8080 },
});

// … and discover services on the network.
for await (const svc of browse({ service: { type: "http", protocol: "tcp" } })) {
  if (svc.kind === "resolved") {
    console.log(`Found ${svc.name} at ${svc.host}:${svc.port}`, svc.txt);
  } else if (svc.kind === "removed") {
    console.log(`${svc.name} went away`);
  }
}

await handle.stop(); // send a goodbye and unregister
```

## Architecture

```
        ┌──────────────────────────────────────────────┐
        │            @momics/dns-sd-shared              │
        │  public API: browse() / advertise()           │
        │  ┌──────────────┐   ┌───────────────────────┐ │
        │  │ mDNS engine  │   │ DNS wire codec         │ │
        │  │ cache/query/ │   │ (RFC 1035/6762/6763)   │ │
        │  │ responder    │   │ hardened decode/encode │ │
        │  └──────┬───────┘   └───────────────────────┘ │
        │         │ drives                               │
        │   ┌─────┴───────────┐        ┌───────────────┐ │
        │   │ DatagramTransport│       │ DnsSdAdapter  │ │
        │   │ (UDP multicast)  │       │ (OS resolver) │ │
        │   └─────┬───────────┘        └──────┬────────┘ │
        └─────────┼──────────────────────────┼──────────┘
                  │                           │
        ┌─────────┴────────┐        ┌─────────┴──────────┐
        │ Deno / Node.js   │        │ Tauri (desktop +   │
        │ (native UDP)     │        │ iOS/Android via OS)│
        └──────────────────┘        └────────────────────┘
```

- The **shared engine** implements the mDNS protocol once, over an abstract
  `DatagramTransport`. Runtimes with raw UDP (Deno, Node) just provide a socket.
- The **`DnsSdAdapter`** seam exists for platforms that cannot do raw multicast
  (notably iOS/Android): the OS performs mDNS and the adapter maps its events to
  our `ServiceAnnouncement` type.
- An **in-memory loopback transport** implements a virtual multicast bus so the
  entire engine is deterministically testable with no network, and a shared
  **conformance suite** lets every runtime prove identical behaviour.

## Caveats (honest ones)

- This is **not** a browser library — browsers cannot open raw UDP multicast
  sockets, and there is no WebExtension mDNS API.
- On **mobile** (iOS/Android) discovery goes through the OS resolver via the
  Tauri adapter; you do not get raw packet-level control there, and the platform
  imposes its own permission prompts and limitations.
- Multicast behaviour depends on the network: some Wi-Fi networks and VPNs block
  or rate-limit multicast traffic.

## Development

This is a dual Deno + npm workspace.

```bash
deno task check      # typecheck source + tests (Deno)
deno lint            # lint
deno fmt --check     # formatting
deno task test       # run the suite under Deno

npm ci
npm run typecheck    # typecheck under tsc
npm run test:node    # build with tsc and run the suite under Node.js
```

CI runs the same commands and executes the shared test suite under **both** Deno
and Node.js to guarantee runtime-neutrality.

## License

Dual-licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](./LICENSE-APACHE))
- MIT license ([LICENSE-MIT](./LICENSE-MIT))

at your option.
