// Cross-runtime interop helper: browse for a service with the Node runtime.
//
// Usage: node node-browse.mjs <expectedName> <timeoutMs>
//
// Browses _http._tcp and, on the first fully-resolved instance whose name
// matches <expectedName>, prints "RESOLVED <json>" (host/port/addresses/txt)
// and exits 0. If the timeout elapses first it prints "TIMEOUT" and exits 1.
// Uses `localAddresses: []` so an advertiser on the SAME host is discoverable.

import { browse, close } from "@momics/dns-sd-node";
import { createNodeDnsSd } from "@momics/dns-sd-node";

const expectedName = process.argv[2] ?? "Node Interop";
const timeoutMs = Number(process.argv[3] ?? 15000);

// A dedicated instance with localAddresses: [] (the module-level `browse`
// helper uses real addresses, which would hide a same-host advertiser).
const dnssd = createNodeDnsSd({ localAddresses: [] });

function describeTxt(txt) {
  const out = {};
  const decoder = new TextDecoder();
  for (const [key, value] of Object.entries(txt)) {
    if (value === true) out[key] = true;
    else if (value === null) out[key] = null;
    else out[key] = decoder.decode(value);
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
  await close();
}

if (!done) {
  console.log("TIMEOUT");
  process.exit(1);
}
process.exit(0);
