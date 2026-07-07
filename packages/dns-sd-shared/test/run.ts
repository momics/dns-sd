/**
 * Cross-runtime test entry point. Runs under both:
 *   - Deno: `deno run test/run.ts`
 *   - Node: `node dist/test/run.js` (after `tsc`)
 *
 * @module
 */

import { runAll } from "./harness.ts";
import "./codec.test.ts";
import "./naming.test.ts";
import "./engine.test.ts";
import "./e2e.test.ts";

await runAll();
