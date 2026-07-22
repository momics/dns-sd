/**
 * Test entry point for the Tauri guest-js binding. The adapter's pure mapping
 * logic is runtime-neutral, so this same file runs through the shared harness
 * under both Deno (`deno run guest-js/run.ts`) and Node (`node dist-test/run.js`
 * after `tsc -p tsconfig.test.json`).
 *
 * @module
 */

import { runAll } from "@momics/dns-sd-shared/testing/harness";
import "./adapter-core.test.ts";

await runAll();
