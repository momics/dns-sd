/**
 * Example: browse for HTTP services on the local network.
 *
 * Run with:
 *   deno run --unstable-net --allow-net --allow-sys examples/browse.ts
 */

import { browse, close } from "../src/mod.ts";

console.log("🔍 Browsing for _http._tcp services (30s)...\n");

// Stop after 30 seconds via an abort signal.
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);

try {
  for await (
    const svc of browse({
      service: { type: "http", protocol: "tcp" },
      signal: controller.signal,
    })
  ) {
    if (svc.kind === "removed") {
      console.log(`❌ ${svc.name} went away\n`);
      continue;
    }

    console.log(`📡 [${svc.kind}] ${svc.name}`);
    if (svc.host) console.log(`   host: ${svc.host}:${svc.port}`);
    if (svc.addresses.length > 0) {
      console.log(`   addresses: ${svc.addresses.join(", ")}`);
    }

    const txtKeys = Object.keys(svc.txt);
    if (txtKeys.length > 0) {
      console.log("   txt:");
      for (const [key, value] of Object.entries(svc.txt)) {
        if (value === true) console.log(`     ${key} (present)`);
        else if (value === null) console.log(`     ${key} (empty)`);
        else console.log(`     ${key} = ${new TextDecoder().decode(value)}`);
      }
    }
    console.log();
  }
} finally {
  await close();
  console.log("Done.");
}
