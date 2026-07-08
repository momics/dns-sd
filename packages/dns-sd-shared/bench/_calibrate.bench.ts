/**
 * Calibration benchmark — a machine-speed reference, not a library hot path.
 *
 * The perf gate (`scripts/perf-gate.ts`) runs on heterogeneous, noisy CI
 * runners, so it never compares a benchmark's *absolute* time against a
 * baseline captured on a different (faster) machine — that would fail green
 * code purely because the runner is slower. Instead it divides every hot-path
 * benchmark's mean by this calibration benchmark's mean, yielding a
 * dimensionless "work relative to a fixed CPU loop" figure that cancels most of
 * the hardware difference between where the baseline was captured and where the
 * gate runs.
 *
 * This function therefore must do a **fixed, deterministic** amount of work per
 * call (no allocation, no library code, no data-dependent branching) so its
 * mean tracks raw CPU speed and nothing else. Do not change it without
 * re-baselining every hot path (the normalisation reference would shift).
 *
 * @module
 */

/** The reference name the gate looks for; keep in sync with `perf-gate.ts`. */
export const CALIBRATION_NAME = "calibrate/reference-loop";

Deno.bench(CALIBRATION_NAME, () => {
  // A fixed integer-mixing loop. Deterministic and allocation-free so its
  // per-iteration mean reflects only the machine's scalar throughput.
  let x = 1;
  for (let i = 0; i < 2000; i++) {
    x = (x * 1664525 + 1013904223) & 0x7fffffff;
    x ^= x >>> 7;
  }
  if (x === 0) throw new Error("unreachable");
});
