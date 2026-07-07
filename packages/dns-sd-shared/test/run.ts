/**
 * Cross-runtime test entry point. Runs under both:
 *   - Deno: `deno run test/run.ts`
 *   - Node: `node dist/test/run.js` (after `tsc`)
 *
 * @module
 */

import { runAll } from "../src/testing/harness.ts";
import "./echo.test.ts";
import "./codec.test.ts";
import "./codec.property.test.ts";
import "./naming.test.ts";
import "./engine.test.ts";
import "./responder.test.ts";
import "./e2e.test.ts";
import "./adapter.test.ts";

await runAll();
