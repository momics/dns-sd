# @momics/dns-sd-shared

The shared, **runtime-agnostic** foundation for the `@momics/dns-sd` library
family. Pure TypeScript, **zero native or runtime-specific dependencies**. It
performs no I/O of its own — a runtime package injects a backend and gets the
identical public API back.

It contains:

- the **public API types** and the `createDnsSd` factory;
- a hardened, standards-compliant **DNS/mDNS wire codec** (RFC 1035 / 6762 / 6763);
- the runtime-agnostic **mDNS engine** (query scheduling & back-off, a record
  cache with TTL expiry and cache-flush handling, known-answer suppression, and
  the full advertise probe → announce → conflict-resolution → goodbye lifecycle);
- two **backend seams**: `DatagramTransport` (UDP multicast) and `DnsSdAdapter`
  (OS resolver);
- an **in-memory loopback transport** (a virtual multicast bus) and a shared
  **conformance suite** for testing.

## Public API

```typescript no-check
/** Continuously discover service instances. */
browse(opts: BrowseOpts): AsyncGenerator<ServiceAnnouncement, void, void>;

/** Advertise a service on the local network. */
advertise(opts: AdvertiseOpts): Promise<AdvertiseHandle>;
```

Both are obtained from a `DnsSd` created via `createDnsSd(backend)`:

```typescript no-check
import { createDnsSd } from "@momics/dns-sd-shared";

// Runtime with raw UDP (Deno, Node):
const dnsSd = createDnsSd({ transport: myDatagramTransport });

// Runtime that must use the OS resolver (Tauri iOS/Android):
const dnsSd = createDnsSd({ adapter: myDnsSdAdapter });

for await (const svc of dnsSd.browse({ service: { type: "http", protocol: "tcp" } })) {
  // svc.kind is "found" | "resolved" | "updated" | "removed"
}
```

Stop a browse by `break`-ing out of the loop, calling the generator's
`.return()`, passing a `signal`, or setting `timeoutMs`. Stop an advertisement
via the returned handle's `stop()` (or `await using`).

## Backend seams

A runtime package implements **one** of these and passes it to `createDnsSd`.

### `DatagramTransport` (Deno / Node)

```typescript no-check
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

The shared engine drives the full mDNS protocol over this socket.

### `DnsSdAdapter` (Tauri / native mobile)

```typescript no-check
interface DnsSdAdapter {
  browseStart(spec: BrowseServiceSpec, sink: ServiceSink): Promise<AdapterBrowseHandle>;
  advertiseStart(spec: AdvertiseServiceSpec): Promise<AdapterAdvertiseHandle>;
  close(): Promise<void>;
}
```

Here the OS performs mDNS; the adapter just maps OS events to
`ServiceAnnouncement` values via the `sink`.

## Conformance suite

Every runtime package should run the shared conformance suite against its own
backend to prove identical behaviour:

```typescript no-check
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
`LoopbackTransport`, an in-memory virtual multicast bus used to test the engine
with no network.

## Testing this package

```bash
deno task test    # Deno
npm run test:node # Node.js (tsc build + run)
```

## License

Dual-licensed under MIT or Apache-2.0, at your option.
