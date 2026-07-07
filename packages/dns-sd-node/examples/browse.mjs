// Browse for services on the local network using @momics/dns-sd-node.
//
// Usage:
//   node examples/browse.mjs [serviceType] [protocol]
// Examples:
//   node examples/browse.mjs                 # browses _http._tcp
//   node examples/browse.mjs ipp tcp
//   node examples/browse.mjs googlecast tcp
//
// Press Ctrl-C to stop.

import { browse, close } from "@momics/dns-sd-node";

const type = process.argv[2] ?? "http";
const protocol = process.argv[3] === "udp" ? "udp" : "tcp";

const controller = new AbortController();
process.on("SIGINT", () => {
  console.log("\nStopping…");
  controller.abort();
});

console.log(`Browsing for _${type}._${protocol}.local — Ctrl-C to stop.\n`);

try {
  for await (
    const svc of browse({
      service: { type, protocol },
      signal: controller.signal,
    })
  ) {
    const where = svc.addresses.length > 0
      ? `${svc.addresses.join(", ")}:${svc.port}`
      : "(unresolved)";
    console.log(`[${svc.kind.padEnd(8)}] ${svc.name} — ${where}`);
    if (svc.kind === "resolved" && Object.keys(svc.txt).length > 0) {
      console.log(`             txt: ${JSON.stringify(describeTxt(svc.txt))}`);
    }
  }
} finally {
  await close();
}

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
