# @momics/dns-sd-node

Discover and advertise services on the local network from **Node.js** — the same
`browse` / `advertise` / `close` API as every `@momics/dns-sd` package. Pure
TypeScript, **no native dependencies**: Node has everything needed for raw mDNS
multicast built in.

- **Standards-compliant** mDNS / DNS-SD (RFC 6762 + RFC 6763): probing, conflict
  resolution, known-answer suppression, TTL cache, and goodbyes are all handled
  for you.
- **Continuous by default**: `browse` never times out unless you ask it to.

## Install

```bash
npm i @momics/dns-sd-node
```

> **Node desktop / server only.** This package needs raw UDP multicast sockets,
> so it does **not** work in browsers, and is not intended for mobile
> (iOS/Android), where the OS owns the mDNS resolver — use `@momics/dns-sd-tauri`
> there instead. Node **18+** is required.

## Usage

### Browse

```ts
import { browse } from "@momics/dns-sd-node";

for await (
  const svc of browse({ service: { type: "http", protocol: "tcp" } })
) {
  // svc.kind is "found" | "resolved" | "updated" | "removed"
  console.log(svc.kind, svc.name, svc.addresses, svc.port);
}
```

Stop a browse by `break`-ing the loop, calling the generator's `.return()`,
passing an `AbortSignal`, or setting `timeoutMs`:

```ts
import { browse } from "@momics/dns-sd-node";

const ac = new AbortController();
setTimeout(() => ac.abort(), 10_000);
for await (
  const svc of browse({
    service: { type: "ipp", protocol: "tcp" },
    signal: ac.signal,
  })
) {
  console.log(svc);
}
```

### Advertise

```ts
import { advertise, close } from "@momics/dns-sd-node";

const handle = await advertise({
  service: {
    type: "http",
    protocol: "tcp",
    name: "My Web Server",
    port: 8080,
    txt: { path: "/", version: "1.0" },
  },
});

console.log("Advertising as", handle.fullName);

// Later — sends a goodbye so peers drop the service promptly:
await handle.stop();
await close();
```

### Advanced configuration

The module-level `browse` / `advertise` / `close` wrap a lazily-created default
transport. For finer control (a specific IP family, host name, interface set, or
engine timing), build your own instance:

```ts
import { createNodeDnsSd, NodeTransport } from "@momics/dns-sd-node";

// Convenience factory:
const dnsSd = createNodeDnsSd({ family: "IPv4", hostname: "my-device" });

// Or wire the transport into the shared factory directly:
import { createDnsSd } from "@momics/dns-sd-node";
const custom = createDnsSd({ transport: new NodeTransport({ multicastTtl: 4 }) });
```

`NodeTransport` options:

| Option              | Default            | Description                                                        |
| ------------------- | ------------------ | ------------------------------------------------------------------ |
| `family`            | `"IPv4"`           | `"IPv4"` (`224.0.0.251`) or `"IPv6"` (`ff02::fb`).                  |
| `hostname`          | `os.hostname()`    | Advertised host label; a `.local` suffix is ensured.               |
| `port`              | `5353`             | mDNS port to bind.                                                 |
| `multicastTtl`      | `255`              | Outgoing multicast TTL (IPv4).                                     |
| `multicastLoopback` | `true`             | Loop our multicast back to this host (needed for same-host peers). |
| `localAddresses`    | auto-detected      | Our own addresses; `[]` disables the engine's address-based self-filter. |
| `interfaces`        | all non-internal   | Restrict group membership to these interface addresses.            |

## Networking notes

mDNS uses **UDP multicast on port 5353** (group `224.0.0.251` for IPv4,
`ff02::fb` for IPv6). For discovery to work:

- **Firewall**: allow inbound/outbound UDP on port `5353`. On macOS the built-in
  firewall usually permits it; on Linux with `firewalld`/`ufw` you may need to
  open it (e.g. `mdns` service). Corporate/VPN firewalls frequently block
  multicast entirely.
- **Multicast-capable network**: many cloud VMs, containers, and Wi-Fi guest
  networks disable multicast; discovery will silently find nothing there.
- **Multiple hosts**: peers on different machines are distinguished by source
  address automatically, so cross-host discovery and advertising work out of the
  box with the default settings.
- **Same host, multiple instances**: by default a browse in one process won't
  discover an advertisement made by another process on the **same machine** (they
  share the host's IP and are treated as self-echo). For local-only testing where
  that *is* what you want, construct transports with `localAddresses: []`. See
  [docs/architecture.md](../../docs/architecture.md#running-multiple-instances-on-one-host).

## Testing

```bash
# Always-on transport unit tests (no network needed):
npm run test:node --workspace @momics/dns-sd-node

# Also run the shared conformance suite over REAL UDP multicast:
DNS_SD_NETWORK_TESTS=1 npm run test:node --workspace @momics/dns-sd-node
```

The conformance cases come straight from
[`@momics/dns-sd-shared/testing`][shared] and are run against real
`NodeTransport` sockets, proving this runtime behaves identically to every other.

## Examples

```bash
node packages/dns-sd-node/examples/browse.mjs           # browse _http._tcp
node packages/dns-sd-node/examples/advertise.mjs "Demo" 8080
```

## License

Dual-licensed under MIT or Apache-2.0, at your option.

[shared]: https://github.com/momics/dns-sd/tree/main/packages/dns-sd-shared
