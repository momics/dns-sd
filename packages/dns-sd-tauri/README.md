# @momics/dns-sd-tauri

The **Tauri v2 runtime** for the `@momics/dns-sd` library family. It provides
DNS-SD (mDNS / Bonjour / Zeroconf) service discovery and advertisement inside a
Tauri application across **desktop (Linux / macOS / Windows)** and **mobile
(iOS + Android)**, and re-exports the **identical public API** as the Deno and
Node.js runtimes.

```typescript
import { advertise, browse } from "@momics/dns-sd-tauri";
```

## How it works

The shared [`@momics/dns-sd-shared`](../dns-sd-shared) package defines two
backend seams:

- `DatagramTransport` — raw UDP multicast, where the shared engine speaks mDNS
  itself (used by the Deno / Node runtimes);
- `DnsSdAdapter` — a higher-level seam that **delegates to the OS resolver**.

This package uses the **adapter** seam. On iOS and Android you cannot open raw
UDP multicast sockets, so discovery **must** go through the platform resolver
(Apple's Bonjour / `NWBrowser` / `NWListener`, Android's `NsdManager`). For
consistency the desktop path also delegates — to the [`mdns-sd`][mdns-sd] crate
running in the Rust plugin — rather than driving the shared engine. The shared
mDNS engine is therefore **not** used on this path; the OS (or `mdns-sd`) owns
the protocol, and the guest-js adapter maps native browse/advertise events onto
the shared `ServiceAnnouncement` shape.

```
guest-js (this pkg)                Rust / native plugin
──────────────────                 ────────────────────
browse()  ── DnsSdAdapter ──▶ IPC ──▶ desktop: mdns-sd crate
advertise()                          iOS:     NWBrowser / NWListener
close()                              Android: NsdManager
        ◀── ServiceAnnouncement ◀── native browse/advertise events
```

## Architecture

| Layer            | Location                          | Responsibility                                       |
| ---------------- | --------------------------------- | ---------------------------------------------------- |
| Guest-js adapter | `guest-js/`                       | Implements `DnsSdAdapter`, derives `kind`, TXT codec |
| Rust plugin      | `src/`                            | Commands, models, desktop `mdns-sd` implementation   |
| iOS              | `ios/Sources/DnsSdPlugin.swift`   | `NWBrowser` / `NWListener` (Network.framework)       |
| Android          | `android/.../DnsSdPlugin.kt`      | `NsdManager`                                         |
| Example          | `examples/tauri-app/`             | A working browse/advertise demo app                  |

The guest-js binding derives the unified `ServiceEventKind`
(`found` → `resolved` → `updated` → `removed`) that the shared public API
guarantees, from each platform's `isActive` + host/port signals. Both `kind`
**and** `isActive` are emitted on every event.

## Public API

Identical to every other `@momics/dns-sd` runtime:

```typescript
/** Continuously discover service instances. */
export const browse: (opts: BrowseOpts) => AsyncGenerator<ServiceAnnouncement>;

/** Advertise a service on the local network. */
export const advertise: (opts: AdvertiseOpts) => Promise<AdvertiseHandle>;

/** Release the underlying adapter. */
export const close: () => Promise<void>;
```

### Browse

```typescript
import { browse } from "@momics/dns-sd-tauri";

const controller = new AbortController();
for await (const svc of browse({
  service: { type: "http", protocol: "tcp" },
  signal: controller.signal,
})) {
  console.log(svc.kind, svc.name, svc.host, svc.port, svc.addresses);
}
```

`browse` runs until the optional `signal` aborts or the optional `timeoutMs`
elapses — that lifecycle is owned by the **shared** layer, so the native browse
is started in continuous mode and torn down when the generator ends.

### Advertise

```typescript
import { advertise } from "@momics/dns-sd-tauri";

await using handle = await advertise({
  service: {
    name: "My Service",
    type: "http",
    protocol: "tcp",
    port: 8080,
    txt: { path: "/", version: new Uint8Array([1, 0]), secure: true },
  },
});
```

## Installation into a Tauri app

1. Add the Rust plugin to `src-tauri/Cargo.toml`:

   ```toml
   tauri-plugin-dns-sd = { path = "../path/to/packages/dns-sd-tauri" }
   ```

2. Register it in your Tauri builder:

   ```rust
   tauri::Builder::default()
       .plugin(tauri_plugin_dns_sd::init())
   ```

3. Grant the plugin's command permissions in your capabilities file:

   ```json
   { "permissions": ["dns-sd:default"] }
   ```

   `dns-sd:default` allows `browse_start`, `browse_stop`, `advertise_start` and
   `advertise_stop`.

4. Install the guest-js binding and call `browse` / `advertise` from your
   frontend.

See [`examples/tauri-app/`](./examples/tauri-app) for a complete, runnable demo.

## TXT records

DNS-SD TXT entries have three distinct states, and all three round-trip through
this package on desktop:

| State             | Contract value | Wire (over IPC) | On the network |
| ----------------- | -------------- | --------------- | -------------- |
| Bare key (flag)   | `true`         | `true`          | `key`          |
| Present but empty | `null`         | `null`          | `key=`         |
| Byte value        | `Uint8Array`   | `number[]`      | `key=<bytes>`  |

Plain `string` inputs to `advertise` are UTF-8 encoded (RFC 6763 §6.5).

## Platform matrix & limitations

| Feature                       | Desktop (`mdns-sd`) | iOS (`NWBrowser`+`NetService`) | Android (`NsdManager`)     |
| ----------------------------- | ------------------- | --------------------- | -------------------------- |
| Browse / advertise            | ✅                  | ✅                    | ✅                         |
| TXT records                   | ✅ (3 states)       | ✅ (3 states)         | ⚠️ bare-key vs empty merged |
| Subtypes (`_sub`)             | ✅                  | ⚠️ accepted, not filtered | ⚠️ accepted, ignored     |
| Custom `host`                 | ✅                  | ⚠️ limited            | ❌ chosen by OS            |
| Custom `domain`               | ✅ (non-`local`)    | ⚠️ limited            | ❌ `local` only            |
| Host/address resolution on browse | ✅              | ✅                    | ✅                         |
| Browse timeout / abort        | ✅ (shared layer)   | ✅                    | ✅                         |
| `removed` (isActive:false)    | ✅                  | ✅                    | ✅                         |

**iOS:** `NWBrowser` discovers endpoints and their TXT records but does not
surface host/addresses on its own (Network.framework resolves lazily inside a
connection). To reach desktop/Android parity the plugin resolves each discovered
instance through `NetService` (Bonjour), emitting `found` first and then
`resolved` once host name, port and IP addresses are available. TXT data is
delivered throughout.

**Android:** `NsdManager` owns the published host name and only supports the
`local` domain, so `host`/`domain` on `advertise` are ignored. It also cannot
represent a bare TXT key distinctly from an empty value, so both are surfaced as
`true`. Subtypes are accepted for API parity but not honoured.

## Testing

| Coverage                                             | Platform | Automated?             |
| ---------------------------------------------------- | -------- | ---------------------- |
| Guest-js kind-derivation + TXT codec (unit)          | all      | ✅ `deno test`         |
| Rust command impls: browse↔advertise, TXT, goodbye, timeout | desktop | ✅ `cargo test`  |
| Real-network discovery (two instances on one host)   | desktop  | ✅ gated, see below    |
| iOS / Android native paths                            | mobile   | ⚠️ manual via example  |

- **Guest-js unit tests** (`guest-js/adapter-core.test.ts`) exercise the pure
  mapping logic — the `found → resolved → updated → removed` state machine and
  the TXT encoders — with no webview or IPC. Run with
  `deno task --cwd packages/dns-sd-tauri test`.

- **Rust tests** (`src/desktop/commands.rs`, `#[cfg(test)]`) drive the desktop
  command implementations directly through a `tauri::test` mock app. TXT
  three-state parity is asserted always; the **network** tests (real loopback
  mDNS browse↔advertise, goodbye, timeout) are gated behind an environment flag
  so CI stays hermetic:

  ```bash
  cargo test                          # unit + parity tests
  DNS_SD_NETWORK_TESTS=1 cargo test   # + real-network end-to-end tests
  ```

  > **Note:** the network tests depend on a live network segment and the host's
  > mDNS stack. On macOS the Application Firewall may silently drop inbound mDNS
  > for a **freshly built** test binary on its first run (until the binary is
  > approved), so a cold run can time out; re-running succeeds. They are gated
  > out of CI for exactly this reason.

- **iOS / Android** cannot be built here without Xcode / the Android SDK; verify
  them by running the [example app](./examples/tauri-app) on a device or
  simulator on a shared network segment.

CI (`.github/workflows/tauri.yml`) builds the Rust plugin on Linux, macOS and
Windows, runs `cargo test`, and typechecks + builds + lints the guest-js
binding.

## Naming

| Concept          | Value                    |
| ---------------- | ------------------------ |
| npm package      | `@momics/dns-sd-tauri`   |
| Rust crate       | `tauri-plugin-dns-sd`    |
| Tauri plugin id  | `dns-sd`                 |
| Global (bundle)  | `__TAURI_PLUGIN_DNS_SD__`|
| iOS class / init | `DnsSdPlugin` / `init_plugin_dns_sd` |
| Android package  | `com.momics.dnssd`       |

## License

MIT OR Apache-2.0

[mdns-sd]: https://crates.io/crates/mdns-sd
