/**
 * Cross-runtime interop helper: advertise a service with the Deno runtime.
 *
 * Usage:
 *   deno run --unstable-net --allow-net --allow-sys --allow-env \
 *     deno-advertise.ts <name> <port>
 *
 * Prints "READY <fullName>" once the advertisement is live, then stays alive
 * until SIGINT/SIGTERM (sending a goodbye). Uses `localAddresses: []` so a
 * browser on the SAME host is not filtered as our own traffic.
 */

import { createNode } from "../../packages/dns-sd-deno/src/mod.ts";

const name = Deno.args[0] ?? "Deno Interop";
const port = Number(Deno.args[1] ?? 8080);

const dnssd = createNode({ localAddresses: [] });

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
    Deno.exit(0);
  }
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

await new Promise(() => {});
