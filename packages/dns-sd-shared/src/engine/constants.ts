/**
 * Timing and protocol constants for the mDNS engine (RFC 6762).
 *
 * All durations are in milliseconds. The defaults follow the RFC; tests can
 * supply an accelerated {@link EngineTiming} to converge quickly in-process.
 *
 * @module
 */

/** Tunable timing parameters for the engine. */
export interface EngineTiming {
  /** Minimum initial delay before the first query (RFC 6762 §5.2: 20–120ms). */
  initialQueryMinMs: number;
  /** Maximum initial delay before the first query. */
  initialQueryMaxMs: number;
  /** Interval before the second query; subsequent intervals double up to a cap. */
  queryIntervalStartMs: number;
  /** Maximum interval between successive periodic queries (RFC 6762 §5.2: 60 min). */
  queryIntervalMaxMs: number;
  /** Delay before the first probe (RFC 6762 §8.1: 0–250ms random). */
  probeDelayMaxMs: number;
  /** Interval between the three probes (RFC 6762 §8.1: 250ms). */
  probeIntervalMs: number;
  /** Number of probes to send before claiming a name (RFC 6762 §8.1). */
  probeCount: number;
  /** Interval between the two initial announcements (RFC 6762 §8.3: 1s). */
  announceIntervalMs: number;
  /** Number of announcements to send (RFC 6762 §8.3). */
  announceCount: number;
  /** How long, after a TTL=0 goodbye, to keep a record before deleting it. */
  goodbyeGraceMs: number;
  /** Minimum spacing between responses to duplicate queries (RFC 6762 §6). */
  responseAggregationMinMs: number;
  /** Maximum random response delay for aggregation. */
  responseAggregationMaxMs: number;
}

/** Default RFC 6762 timing. */
export const DEFAULT_TIMING: EngineTiming = {
  initialQueryMinMs: 20,
  initialQueryMaxMs: 120,
  queryIntervalStartMs: 1000,
  queryIntervalMaxMs: 60 * 60 * 1000,
  probeDelayMaxMs: 250,
  probeIntervalMs: 250,
  probeCount: 3,
  announceIntervalMs: 1000,
  announceCount: 2,
  goodbyeGraceMs: 1000,
  responseAggregationMinMs: 20,
  responseAggregationMaxMs: 120,
};

/**
 * Accelerated timing for deterministic in-process tests. Preserves the
 * ordering and number of protocol phases while collapsing the delays.
 */
export const FAST_TIMING: EngineTiming = {
  initialQueryMinMs: 1,
  initialQueryMaxMs: 3,
  queryIntervalStartMs: 20,
  queryIntervalMaxMs: 200,
  probeDelayMaxMs: 2,
  probeIntervalMs: 5,
  probeCount: 3,
  announceIntervalMs: 5,
  announceCount: 2,
  goodbyeGraceMs: 20,
  responseAggregationMinMs: 1,
  responseAggregationMaxMs: 3,
};

/** Default TTL (seconds) for shared records: PTR (RFC 6763 §6.1 recommends 75 min for these actually). */
export const TTL_SHARED = 4500;
/** Default TTL (seconds) for host records that should be refreshed often. */
export const TTL_HOST = 120;
