// Advertise a service on the local network using @momics/dns-sd-node.
//
// Usage:
//   node examples/advertise.mjs [name] [port]
// Example:
//   node examples/advertise.mjs "My Web Server" 8080
//
// The service is advertised as _http._tcp.local. Discover it from another
// terminal with `node examples/browse.mjs`, or with `dns-sd -B _http._tcp`
// (macOS) / `avahi-browse -r _http._tcp` (Linux).
//
// Press Ctrl-C to send a goodbye and exit.

import { advertise, close } from "@momics/dns-sd-node";

const name = process.argv[2] ?? "Example Web Server";
const port = Number(process.argv[3] ?? 8080);

const handle = await advertise({
  service: {
    type: "http",
    protocol: "tcp",
    name,
    port,
    txt: { path: "/", version: "1.0" },
  },
});

console.log(`Advertising "${handle.name}" on _http._tcp.local:${port}`);
console.log(`Full name: ${handle.fullName}`);
console.log("Press Ctrl-C to stop (a goodbye packet will be sent).");

const shutdown = async () => {
  console.log("\nStopping advertisement…");
  await handle.stop();
  await close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the process alive.
await new Promise(() => {});
