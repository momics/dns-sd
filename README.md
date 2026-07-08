# @momics/dns-sd

Discover and advertise services on the local network — the same technology as
Bonjour and Zeroconf — through one identical `browse` / `advertise` API across
**Node.js**, **Deno** and **Tauri** (desktop **and** mobile). Standards-compliant
mDNS (RFC 1035 / 6762 / 6763), with a pure-TypeScript core and zero native
dependencies.

> [!WARNING]
> **Experimental.** Largely AI-generated, lightly tested, not yet published, and
> not production-ready. Use at your own risk.

## Packages

| Package | Runtime | Install (once published) |
| --- | --- | --- |
| [`@momics/dns-sd-shared`](./packages/dns-sd-shared) | any | the pure-TS codec + mDNS engine (no I/O of its own) |
| [`@momics/dns-sd-node`](./packages/dns-sd-node) | Node.js | `npm install @momics/dns-sd-node` |
| [`@momics/dns-sd-deno`](./packages/dns-sd-deno) | Deno | `deno add jsr:@momics/dns-sd-deno` |
| [`@momics/dns-sd-tauri`](./packages/dns-sd-tauri) | Tauri v2 | `npm install @momics/dns-sd-tauri` |

Pick the package for your runtime — they all re-export the same API; `-shared`
is the foundation the others build on.

## Support

| Platform | Runtimes |
| --- | --- |
| Linux · macOS · Windows | Node.js · Deno · Tauri (desktop) |
| iOS · Android | Tauri |

Node, Deno and Tauri desktop speak mDNS directly over UDP multicast; on mobile,
Tauri defers to the OS resolver, which imposes a few limits — see the
[Tauri README](./packages/dns-sd-tauri/README.md#platform-matrix--limitations).

## Usage

```bash
npm install @momics/dns-sd-node
```

**Advertise** a service:

```typescript
import { advertise, browse, close } from "@momics/dns-sd-node";

const handle = await advertise({
  service: {
    type: "http",
    protocol: "tcp",
    name: "My Web Server",
    port: 8080,
    txt: { path: "/api", secure: true },
  },
});
```

**Browse** for services — an async iterator of lifecycle events:

```typescript
import { browse } from "@momics/dns-sd-node";

for await (const svc of browse({
  service: { type: "http", protocol: "tcp" },
  timeoutMs: 5000, // omit for a continuous browse
})) {
  switch (svc.kind) {
    case "found":    // discovered, host/port not resolved yet
      console.log("found", svc.name);
      break;
    case "resolved": // host and port known; addresses are best-effort
      console.log(`${svc.name} → ${svc.host}:${svc.port}`, svc.addresses, svc.txt);
      break;
    case "updated":  console.log("changed", svc.name); break;
    case "removed":  console.log("gone", svc.name); break;
  }
}
```

**Clean up** when you're done:

```typescript no-check
await handle.stop(); // send a goodbye and unregister
await close();       // tear down the shared socket
```

That's the whole surface — `advertise`, `browse`, `close`. It's identical on
every runtime; only the import and setup differ:

- **Deno** — import from `@momics/dns-sd-deno` and run with
  `deno run --unstable-net --allow-net --allow-sys`.
- **Tauri** — import from `@momics/dns-sd-tauri` and register the
  `tauri-plugin-dns-sd` plugin in your Rust app first (see the
  [Tauri README](./packages/dns-sd-tauri/README.md)).

A `found` event always carries `null` host/port — narrow to `resolved` or
`updated` before you connect.

**TXT records** use the RFC 6763 three-state model: `true` for a bare key,
a value for `key=value`, and `null` for an empty `key=`. When advertising, values
may be a `string`, `Uint8Array`, `true`, or `null`; discovered values come back as
`Uint8Array | true | null`. Keys are validated when you advertise.

## How it works

The mDNS protocol is implemented **once**, in pure TypeScript; each runtime plugs
a thin network backend into that shared engine, so every package exposes the
exact same API. You don't need the details to use the library — if you're curious
or want to add a runtime, see [docs/architecture.md](./docs/architecture.md).

## Contributing

Build, test and release instructions live in [CONTRIBUTING.md](./CONTRIBUTING.md).

This repository is governed by a constitution — [AGENTS.md](./AGENTS.md) — that
defines what "done" means, freezes the public API, and lists the ratchets that
keep the package converging to a small, battle-tested fixed point.
[docs/convergence.md](./docs/convergence.md) explains the philosophy;
[docs/api-design.md](./docs/api-design.md) and
[docs/testing-strategy.md](./docs/testing-strategy.md) cover the API bar and the
testing approach.

## License

Dual-licensed under [Apache-2.0](./LICENSE-APACHE) or [MIT](./LICENSE-MIT), at
your option.
