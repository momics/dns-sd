/**
 * Example: advertise an HTTP service on the local network.
 *
 * Run with:
 *   deno run --unstable-net --allow-net --allow-sys examples/advertise.ts
 */

import { advertise, close } from "../src/mod.ts";

const serviceName = "My Test Server";
const port = 8080;

console.log(`📢 Advertising "${serviceName}" as _http._tcp on port ${port}...`);

const handle = await advertise({
  service: {
    name: serviceName,
    type: "http",
    protocol: "tcp",
    port,
    txt: {
      version: "1.0.0",
      path: "/api",
      secure: true, // bare boolean flag
    },
  },
});

console.log(`✅ Advertising as "${handle.fullName}".`);
console.log("Running for 60s (Ctrl+C to stop early)...\n");

// Send a goodbye and release the socket on Ctrl+C.
Deno.addSignalListener("SIGINT", async () => {
  console.log("\nStopping...");
  await handle.stop();
  await close();
  Deno.exit(0);
});

await new Promise((resolve) => setTimeout(resolve, 60_000));

await handle.stop();
await close();
console.log("✅ Stopped advertising (goodbye sent).");
