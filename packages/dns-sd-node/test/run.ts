/**
 * Node test entry point. Runs the `@momics/dns-sd-node` suite through the shared
 * cross-runtime harness:
 *
 *   node dist/test/run.js   (after `tsc`)
 *
 * The transport unit tests always run; the real-network conformance suite is
 * gated behind `DNS_SD_NETWORK_TESTS=1` and otherwise reported as skipped.
 *
 * @module
 */

import { runAll } from "@momics/dns-sd-shared/testing/harness";
import "./transport.test.ts";
import "./conformance.test.ts";

await runAll();
