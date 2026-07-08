/**
 * Hot-path benchmarks for the record cache (`src/engine/cache.ts`).
 *
 * The cache's `add` runs for every record in every received response
 * (insert-or-refresh, cache-flush handling, expiry/re-query scheduling), and
 * `knownAnswers` is scanned to build known-answer suppression lists — both on
 * the receive hot path (RFC 6762 §7.1, §10).
 *
 * `add` schedules real timers (expiry + re-queries). The fixtures use
 * production TTLs (120–4500 s) so no timer fires during a benchmark run, and
 * each benchmark closes the cache it builds to clear them — keeping the numbers
 * about cache work, not timer callbacks.
 *
 * @module
 */

import { RecordCache } from "../src/engine/cache.ts";
import { DEFAULT_TIMING } from "../src/engine/constants.ts";
import { recordNameTypeKey } from "../src/engine/records.ts";
import { browseRecordBatch } from "./fixtures.ts";

const noop = () => {};

/** ~20 resolved instances → 100 distinct records. */
const batch = browseRecordBatch(20);
const lookupKey = recordNameTypeKey(batch[0]!);

function newCache(): RecordCache {
  return new RecordCache({
    timing: DEFAULT_TIMING,
    onRequery: noop,
    emit: noop,
  });
}

Deno.bench("cache/add: insert browse batch", () => {
  const cache = newCache();
  for (const record of batch) cache.add(record);
  cache.close();
});

Deno.bench("cache/knownAnswers: scan populated cache", (b) => {
  const cache = newCache();
  for (const record of batch) cache.add(record);
  b.start();
  cache.knownAnswers(lookupKey);
  b.end();
  cache.close();
});
