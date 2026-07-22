/**
 * Performance regression gate for the `@momics/dns-sd-shared` hot paths
 * (zero dependencies, Deno-native).
 *
 * ## What it does
 *
 * Runs the `Deno.bench` suite in `bench/` with machine-readable output
 * (`deno bench --json`), normalises each hot-path benchmark against an in-run
 * calibration loop, then compares that normalised figure against a committed
 * baseline (`bench/perf-baseline.json`). It exits non-zero when a hot path
 * regresses past the tolerance band — so a silent order-of-magnitude slowdown
 * fails CI (issue #39, `AGENTS.md` §5).
 *
 *   deno run -A scripts/perf-gate.ts --check   # CI: fail on a real regression
 *   deno run -A scripts/perf-gate.ts --write   # re-baseline deliberately
 *
 * ## Why normalise (hardware independence)
 *
 * Shared CI runners are *noisy* and *slower and different* from the machine
 * that captured the baseline. Comparing absolute nanoseconds across machines
 * would flag green code purely because the runner is 2–3× slower — a false
 * alarm, and a flaky gate is worse than no gate.
 *
 * So the gate never uses absolute time. The suite includes a fixed,
 * allocation-free calibration loop (`bench/_calibrate.bench.ts`) whose mean
 * tracks only the machine's scalar throughput. Every hot-path benchmark is
 * divided by that calibration mean, giving a dimensionless "work units" figure
 * that is roughly constant across machines. The baseline stores those units,
 * and the gate compares units-to-units — so it survives being captured on a
 * fast dev laptop and enforced on a slow CI runner.
 *
 * ## The tolerance band, and why it is generous
 *
 * Even after normalisation, run-to-run noise remains (and the ratio compounds
 * two noisy measurements). The gate is therefore deliberately coarse: it
 * targets **real, order-of-magnitude regressions** (an accidental O(n²), a
 * dropped fast path, a per-call allocation blow-up — which show up as ≥10×),
 * not micro-noise.
 *
 * - {@link SLOWDOWN_FACTOR} — a benchmark fails only when its normalised units
 *   exceed this multiple of the committed baseline. Set to 4×, comfortably
 *   above the normalised run-to-run spread, so normal noise never trips it but
 *   a true regression always does.
 * - {@link ABSOLUTE_FLOOR_NS} — benchmarks whose *measured* mean is only a few
 *   nanoseconds are dominated by timer resolution; a multiple of a tiny number
 *   is still tiny and noise-prone, so such a benchmark passes regardless of
 *   ratio.
 *
 * The baseline is a committed floor that only moves deliberately (via
 * `--write`), mirroring the API-snapshot ratchet. Re-baseline only when a
 * change to the numbers is intended, and record it in `CHANGELOG.md`.
 *
 * ## Metric
 *
 * Normalised time-per-iteration (calibration-relative) is the tracked metric.
 * This Deno version's `deno bench --json` does not expose per-iteration
 * allocation counts, so allocation tracking is deferred (issue #39);
 * wall-clock captures allocation-driven regressions indirectly via GC pressure.
 *
 * @module
 */

import { CALIBRATION_NAME } from "../bench/_calibrate.bench.ts";

/** The benchmark directory, relative to the package root. */
const BENCH_DIR = "bench";

/** Where the committed baseline lives, relative to the package root. */
const BASELINE_PATH = "bench/perf-baseline.json";

/**
 * A benchmark fails the gate when its normalised units exceed this multiple of
 * its committed baseline. Generous by design (see module docs).
 */
const SLOWDOWN_FACTOR = 4;

/**
 * Measured means below this many nanoseconds are treated as "fast enough"
 * regardless of ratio: at this scale timer resolution and noise dominate, so a
 * ratio check would only manufacture flakes.
 */
const ABSOLUTE_FLOOR_NS = 50;

/** One benchmark's committed baseline. */
interface BaselineEntry {
  /** Calibration-normalised work units (mean ns ÷ calibration mean ns). */
  units: number;
  /** Raw mean ns/iter when captured — informational only, not gated. */
  avgNs: number;
}

/** The committed baseline document. */
interface Baseline {
  /** Human note on how/where the numbers were captured. */
  note: string;
  /** Multiplier a measurement may reach before the gate fails. */
  slowdownFactor: number;
  /** Raw calibration mean (ns) when captured — informational only. */
  calibrationNs: number;
  /** Per-benchmark baselines, keyed by benchmark name. */
  benches: Record<string, BaselineEntry>;
}

interface BenchResultOk {
  avg: number;
}
interface BenchResult {
  ok?: BenchResultOk;
}
interface BenchEntry {
  name: string;
  results: BenchResult[];
}
interface BenchJson {
  benches: BenchEntry[];
}

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

/** Run `deno bench --json` over the bench dir and parse the measured means. */
async function measure(): Promise<Map<string, number>> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["bench", "--json", "--allow-read", BENCH_DIR],
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stdout, stderr } = await cmd.output();
  if (!success) {
    fail(`deno bench failed:\n${new TextDecoder().decode(stderr)}`);
  }
  const json = JSON.parse(new TextDecoder().decode(stdout)) as BenchJson;
  const measured = new Map<string, number>();
  for (const bench of json.benches) {
    const avg = bench.results[0]?.ok?.avg;
    if (typeof avg === "number") measured.set(bench.name, avg);
  }
  if (measured.size === 0) fail("deno bench produced no results.");
  return measured;
}

/** Pull the calibration mean out of a measurement set, or fail loudly. */
function calibrationOf(measured: Map<string, number>): number {
  const cal = measured.get(CALIBRATION_NAME);
  if (cal === undefined || !(cal > 0)) {
    fail(
      `Calibration benchmark "${CALIBRATION_NAME}" did not run or measured 0. ` +
        `The gate needs it to normalise across machines.`,
    );
  }
  return cal;
}

async function readBaseline(): Promise<Baseline> {
  let text: string;
  try {
    text = await Deno.readTextFile(BASELINE_PATH);
  } catch {
    fail(
      `No perf baseline at ${BASELINE_PATH}. Capture one first:\n` +
        `  deno task perf:baseline`,
    );
  }
  return JSON.parse(text) as Baseline;
}

const mode = Deno.args.includes("--check")
  ? "check"
  : Deno.args.includes("--write")
  ? "write"
  : fail("usage: perf-gate.ts (--check | --write)");

const measured = await measure();
const calibrationNs = calibrationOf(measured);

if (mode === "write") {
  const benches: Record<string, BaselineEntry> = {};
  for (const name of [...measured.keys()].sort()) {
    if (name === CALIBRATION_NAME) continue;
    const avgNs = measured.get(name)!;
    benches[name] = {
      units: Math.round((avgNs / calibrationNs) * 10000) / 10000,
      avgNs: Math.round(avgNs * 100) / 100,
    };
  }
  const baseline: Baseline = {
    note:
      "Per hot-path benchmark, calibration-normalised work units (`units` = " +
      "mean ns / the calibration loop's mean ns) plus the raw mean ns for " +
      "reference. The gate (`deno task perf:gate`) compares units-to-units so " +
      "it is hardware-independent, and fails a benchmark only when its units " +
      "exceed slowdownFactor x the baseline — a coarse, noise-tolerant guard " +
      "for order-of-magnitude regressions. Re-baseline deliberately (`deno " +
      "task perf:baseline`) and note it in CHANGELOG.md.",
    slowdownFactor: SLOWDOWN_FACTOR,
    calibrationNs: Math.round(calibrationNs * 100) / 100,
    benches,
  };
  await Deno.writeTextFile(
    BASELINE_PATH,
    JSON.stringify(baseline, null, 2) + "\n",
  );
  console.log(
    `Wrote perf baseline → ${BASELINE_PATH} ` +
      `(calibration ${calibrationNs.toFixed(1)}ns)`,
  );
  Deno.exit(0);
}

// mode === "check"
const baseline = await readBaseline();
const factor = baseline.slowdownFactor || SLOWDOWN_FACTOR;

const regressions: string[] = [];
const missing: string[] = [];
const report: string[] = [];

for (const name of Object.keys(baseline.benches).sort()) {
  const baseUnits = baseline.benches[name]!.units;
  const gotNs = measured.get(name);
  if (gotNs === undefined) {
    missing.push(name);
    continue;
  }
  const gotUnits = gotNs / calibrationNs;
  const ratio = gotUnits / baseUnits;
  const overBudget = ratio > factor && gotNs >= ABSOLUTE_FLOOR_NS;
  report.push(
    `  ${overBudget ? "x" : "ok"} ${name}: ${gotUnits.toFixed(3)}u ` +
      `(baseline ${baseUnits.toFixed(3)}u, ${
        ratio.toFixed(2)
      }x — budget ${factor}x)`,
  );
  if (overBudget) {
    regressions.push(
      `${name}: ${gotUnits.toFixed(3)}u is ${ratio.toFixed(2)}x the baseline ` +
        `${baseUnits.toFixed(3)}u (budget ${factor}x)`,
    );
  }
}

console.log(
  `Perf gate — ${BENCH_DIR} (calibration ${calibrationNs.toFixed(1)}ns, ` +
    `slowdown budget ${factor}x):`,
);
console.log(report.join("\n"));

if (missing.length > 0) {
  fail(
    `Perf baseline lists benchmarks that did not run: ${
      missing.join(", ")
    }.\n` +
      `Names drifted — re-baseline deliberately with \`deno task perf:baseline\`.`,
  );
}

if (regressions.length > 0) {
  fail(
    [
      "",
      "PERFORMANCE REGRESSION — a hot path is well past its budget:",
      ...regressions.map((r) => `  - ${r}`),
      "",
      "This is a ratchet (AGENTS.md §5). If the slowdown is a real defect,",
      "fix it. If the change is a deliberate, justified trade-off, re-baseline:",
      "",
      "  deno task perf:baseline   # then note it in CHANGELOG.md",
    ].join("\n"),
  );
}

console.log("\nAll hot paths within budget.");
