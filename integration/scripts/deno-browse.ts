/**
 * Cross-runtime interop helper: browse for a service with the Deno runtime.
 *
 * Usage:
 *   deno run --unstable-net --allow-net --allow-sys --allow-env \
 *     deno-browse.ts <expectedName> <timeoutMs>
 *
 * On the first fully-resolved instance whose name matches <expectedName>,
 * prints "RESOLVED <json>" and exits 0. On timeout prints "TIMEOUT" and exits
 * 1. Uses `localAddresses: []` so a same-host advertiser is discoverable.
 */

import { createNode } from "../../packages/dns-sd-deno/src/mod.ts";
import type { TxtRecords } from "../../packages/dns-sd-shared/src/index.ts";

const expectedName = Deno.args[0] ?? "Deno Interop";
const timeoutMs = Number(Deno.args[1] ?? 15000);

const dnssd = createNode({ localAddresses: [] });

function describeTxt(txt: TxtRecords): Record<string, string | true | null> {
  const out: Record<string, string | true | null> = {};
  const decoder = new TextDecoder();
  for (const [key, value] of Object.entries(txt)) {
    if (value === true) out[key] = true;
    else if (value === null) out[key] = null;
    else out[key] = decoder.decode(value as Uint8Array);
  }
  return out;
}

let done = false;
try {
  for await (
    const svc of dnssd.browse({
      service: { type: "http", protocol: "tcp" },
      timeoutMs,
    })
  ) {
    if (
      svc.kind === "resolved" && svc.name === expectedName &&
      svc.port !== null
    ) {
      const payload = {
        name: svc.name,
        host: svc.host,
        port: svc.port,
        addresses: svc.addresses,
        txt: describeTxt(svc.txt),
      };
      console.log(`RESOLVED ${JSON.stringify(payload)}`);
      done = true;
      break;
    }
  }
} finally {
  await dnssd.close();
}

if (!done) {
  console.log("TIMEOUT");
  Deno.exit(1);
}
Deno.exit(0);
