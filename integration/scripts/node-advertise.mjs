// Cross-runtime interop helper: advertise a service with the Node runtime.
//
// Usage: node node-advertise.mjs <name> <port>
//
// Prints a single line "READY <fullName>" once the advertisement is live, then
// stays alive until SIGTERM/SIGINT (at which point it sends a goodbye). Uses
// `localAddresses: []` so a browser running on the SAME host (the interop test)
// is not filtered out as "our own" traffic by the shared engine.

import { createNodeDnsSd } from "@momics/dns-sd-node";

const name = process.argv[2] ?? "Node Interop";
const port = Number(process.argv[3] ?? 8080);

const dnssd = createNodeDnsSd({ localAddresses: [] });

const handle = await dnssd.advertise({
  service: {
    name,
    type: "http",
    protocol: "tcp",
    port,
    txt: { path: "/api", secure: true, empty: null },
  },
});

console.log(`READY ${handle.fullName}`);

const shutdown = async () => {
  try {
    await handle.stop();
    await dnssd.close();
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise(() => {});
