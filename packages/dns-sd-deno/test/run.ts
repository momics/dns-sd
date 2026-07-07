/**
 * Deno test entry point for `@momics/dns-sd-deno`. Runs the package's suite
 * through the shared cross-runtime harness:
 *
 *   deno run --unstable-net --allow-net --allow-sys --allow-env test/run.ts
 *
 * The transport unit tests use unicast loopback and run everywhere; the
 * real-multicast conformance suite is gated behind `DNS_SD_NETWORK_TESTS=1` and
 * otherwise reported as skipped.
 *
 * @module
 */

import { runAll } from "@momics/dns-sd-shared/testing/harness";
import "./transport_test.ts";
import "./conformance_test.ts";

await runAll();
