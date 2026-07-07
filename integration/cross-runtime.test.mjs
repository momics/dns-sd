// Cross-runtime interop tests: prove that services advertised by ONE runtime
// are discovered and fully resolved by a DIFFERENT runtime over real loopback
// multicast. This is the real proof that the shared wire format and engine
// behave identically across independent transports.
//
// Gated behind DNS_SD_NETWORK_TESTS=1 because it needs working UDP multicast
// (blocked on many CI runners and some corporate networks). Run with:
//
//   DNS_SD_NETWORK_TESTS=1 node --test integration/
//
// Requires the workspace to be built first (`npm run build`) so the Node
// scripts can import the compiled @momics/dns-sd-* packages, and `deno` on PATH
// for the Deno legs.
//
// Each case: start an advertiser, wait for its "READY" line, start a browser
// for the same instance name, and assert it resolves with the correct
// host/port/addresses/TXT. All four runtime pairings are covered.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NETWORK = process.env.DNS_SD_NETWORK_TESTS === "1";
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "scripts");
const DENO_FLAGS = [
  "run",
  "--unstable-net",
  "--allow-net",
  "--allow-sys",
  "--allow-env",
];

function nodeCmd(script, args) {
  return { cmd: process.execPath, args: [join(SCRIPTS, script), ...args] };
}

function denoCmd(script, args) {
  return { cmd: "deno", args: [...DENO_FLAGS, join(SCRIPTS, script), ...args] };
}

const ADVERTISERS = {
  node: (args) => nodeCmd("node-advertise.mjs", args),
  deno: (args) => denoCmd("deno-advertise.ts", args),
};
const BROWSERS = {
  node: (args) => nodeCmd("node-browse.mjs", args),
  deno: (args) => denoCmd("deno-browse.ts", args),
};

/** Spawn a child and resolve once its stdout emits a line starting with `marker`. */
function spawnUntil({ cmd, args }, marker, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out waiting for "${marker}"\n${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const line = buf.split("\n").find((l) => l.startsWith(marker));
      if (line) {
        clearTimeout(timer);
        resolve({ child, line });
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      if (!buf.split("\n").some((l) => l.startsWith(marker))) {
        clearTimeout(timer);
        reject(new Error(`exited (code ${code}) before "${marker}"\n${stderr}`));
      }
    });
  });
}

/** Run a browser child to completion, returning its full stdout. */
function runToEnd({ cmd, args }, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`browser timed out\n${err}`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

async function interop(advertiserRt, browserRt) {
  const name = `${advertiserRt}->${browserRt} ${Date.now() % 100000}`;
  const port = 8080 + Math.floor(Math.random() * 1000);
  const { child: adv } = await spawnUntil(
    ADVERTISERS[advertiserRt]([name, String(port)]),
    "READY",
    20000,
  );
  try {
    const { code, out } = await runToEnd(
      BROWSERS[browserRt]([name, "15000"]),
      20000,
    );
    const line = out.split("\n").find((l) => l.startsWith("RESOLVED"));
    assert.ok(line, `expected a RESOLVED line, got:\n${out}`);
    assert.equal(code, 0);
    const svc = JSON.parse(line.slice("RESOLVED ".length));
    assert.equal(svc.name, name);
    assert.equal(svc.port, port);
    assert.ok(svc.addresses.length > 0, "expected at least one address");
    assert.equal(svc.txt.path, "/api");
    assert.equal(svc.txt.secure, true);
    assert.equal(svc.txt.empty, null);
  } finally {
    adv.kill("SIGTERM");
  }
}

for (const advertiser of ["node", "deno"]) {
  for (const browser of ["node", "deno"]) {
    test(
      `interop: ${advertiser} advertises -> ${browser} browses`,
      { skip: NETWORK ? false : "set DNS_SD_NETWORK_TESTS=1 to run" },
      () => interop(advertiser, browser),
    );
  }
}
