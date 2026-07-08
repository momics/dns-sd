# @momics/dns-sd-deno

The **Deno runtime package** for the `@momics/dns-sd` library family. It is a
thin adapter: it supplies a real UDP-multicast `DatagramTransport` to the
runtime-agnostic engine in
[`@momics/dns-sd-shared`](../dns-sd-shared/README.md) and re-exports the
**identical public API** (`browse` / `advertise` / `close`) plus all shared
types. All the standards-compliant mDNS/DNS-SD logic (RFC 6762 + RFC 6763)
lives in the shared package; this package only owns the socket.

> **Deno desktop only.** This package needs raw UDP multicast, which is
> available on Deno for desktop/server. It is **not** for Deno Deploy or other
> sandboxes without raw sockets. For those, use an OS-resolver adapter package
> instead.

## Install / import

```ts no-check
// Published (placeholder — publishing is not set up in this repo yet):
import { advertise, browse, close } from "jsr:@momics/dns-sd-deno";

// In this monorepo, via the Deno workspace:
import { advertise, browse, close } from "@momics/dns-sd-deno";
```

## Permissions

Raw UDP multicast is an unstable Deno API, and enumerating local addresses /
reading the host name needs `sys` access. Run with:

```
deno run --unstable-net --allow-net --allow-sys your-app.ts
```

| Flag             | Why                                                    |
| ---------------- | ------------------------------------------------------ |
| `--unstable-net` | `Deno.listenDatagram` multicast join is unstable       |
| `--allow-net`    | bind/join/send/receive UDP                             |
| `--allow-sys`    | `Deno.networkInterfaces()` + `Deno.hostname()`         |

## Quick start

### Browse

```ts
import { browse, close } from "@momics/dns-sd-deno";

for await (const svc of browse({ service: { type: "http", protocol: "tcp" } })) {
  if (svc.kind === "removed") {
    console.log("gone:", svc.name);
    continue;
  }
  console.log(svc.kind, svc.name, svc.host, svc.port, svc.addresses);
}

await close();
```

`browse` is **continuous** by default (the shared default `timeoutMs` is `0`).
Pass `timeoutMs` or an `AbortSignal` to stop it:

```ts
import { browse } from "@momics/dns-sd-deno";

browse({ service: { type: "http", protocol: "tcp" }, timeoutMs: 5000 });
```

### Advertise

```ts
import { advertise, close } from "@momics/dns-sd-deno";

const handle = await advertise({
  service: {
    name: "My Server",
    type: "http",
    protocol: "tcp",
    port: 8080,
    txt: { path: "/api", secure: true },
  },
});

console.log("advertising as", handle.fullName);
// ... later — sends a goodbye packet so peers drop it promptly:
await handle.stop();
await close();
```

## API

Everything from `@momics/dns-sd-shared` is re-exported unchanged
(`createDnsSd`, `dnsSdOverTransport`, the `DatagramTransport` seam, the
`MDNS_IPV4` / `MDNS_IPV6` / `MDNS_PORT` constants, and all public types such as
`BrowseOpts`, `AdvertiseOpts`, `ServiceAnnouncement`, `AdvertiseHandle`, …).

Deno-specific additions:

- **`browse` / `advertise` / `close`** — the top-level convenience API, backed
  by a lazily-created default node (IPv4, any interface).
- **`createNode(options?)`** — build a standalone `DnsSd` node backed by a fresh
  `DenoTransport`. Create one per family/interface you want to operate on; call
  `node.close()` to release its socket.
- **`DenoTransport`** — the `DatagramTransport` implementation. Options:

  | Option              | Default                    | Notes                                   |
  | ------------------- | -------------------------- | --------------------------------------- |
  | `family`            | `"IPv4"`                   | `"IPv4"` or `"IPv6"`                     |
  | `port`              | `5353`                     | UDP port                                |
  | `group`             | `224.0.0.251` / `ff02::fb` | multicast group                         |
  | `interfaceAddress`  | `"0.0.0.0"`                | IPv4 membership interface               |
  | `interfaceIndex`    | `0`                        | IPv6 membership interface               |
  | `hostname`          | `Deno.hostname()`          | advertise host derivation               |
  | `localAddresses`    | discovered                 | own addrs; `[]` for same-host (see below) |
  | `multicastLoopback` | `true`                     | hear co-located sockets                 |
  | `multicastTtl`      | —                          | IPv4 TTL                                |

- **`localInterfaceAddresses(family)`** / **`localHostname()`** — the address /
  host-name helpers used by the transport.

```ts
import { createNode } from "@momics/dns-sd-deno";

const node = createNode({ transport: { family: "IPv6" } });
try {
  for await (const svc of node.browse({ service: { type: "http", protocol: "tcp" } })) {
    // ...
  }
} finally {
  await node.close();
}
```

## Testing

```
deno task test           # transport unit tests (real unicast sockets); safe on CI
deno task test:network   # + the shared conformance suite over REAL multicast
```

- **Unit tests** exercise the real socket plumbing (bind, receive, source
  mapping, wire-codec round-trip, close semantics) over **unicast** loopback, so
  they run everywhere — including multicast-blocked CI runners.
- **Conformance tests** run the shared conformance suite against real
  `DenoTransport` sockets. They use genuine multicast, so they are **gated**
  behind `DNS_SD_NETWORK_TESTS=1` and skipped by default.

Multiple nodes coexist on one host by giving each `DenoTransport`
`localAddresses: []`. The shared engine ignores datagrams whose source address
is in `transport.localAddresses()`; on one host every node shares the same
source IP, so real addresses would make each node filter its siblings out.
With `[]` the engine's IP-based own-echo filter becomes a no-op (siblings get
through), `DenoTransport` suppresses our OWN loopback datagrams itself (it
tracks recently-sent bytes and drops an exact match), and `localAddresses()`
falls back to loopback (`127.0.0.1` / `::1`) so advertised services still carry
an A/AAAA record. On a real multi-host network, leave `localAddresses` at its
default (the host's real interface addresses) for correct cross-host records.

> Note: some networks (and many CI runners) administratively block multicast
> routing. On such hosts the gated conformance suite cannot pass — run it on a
> multicast-capable machine.
