/**
 * A tiny cross-runtime test harness. The same test files run unchanged under
 * both `deno run test/run.ts` and (after `tsc`) `node dist/test/run.js`.
 *
 * Tests register themselves via {@link test}; {@link runAll} executes them and
 * reports results, exiting non-zero on any failure.
 *
 * @module
 */

interface RegisteredTest {
  name: string;
  fn: () => void | Promise<void>;
}

const registry: RegisteredTest[] = [];

/** Register a test case. */
export function test(name: string, fn: () => void | Promise<void>): void {
  registry.push({ name, fn });
}

/** Assert a condition is truthy. */
export function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

/** Assert strict (`Object.is`) equality. */
export function assertEquals<T>(
  actual: T,
  expected: T,
  message?: string,
): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      message ??
        `expected ${format(expected)} but got ${format(actual)}`,
    );
  }
}

/** Assert two byte arrays are equal. */
export function assertBytesEqual(
  actual: Uint8Array,
  expected: Uint8Array,
  message?: string,
): void {
  const equal = actual.length === expected.length &&
    actual.every((b, i) => b === expected[i]);
  if (!equal) {
    throw new Error(
      message ??
        `byte arrays differ:\n  expected ${hex(expected)}\n  actual   ${
          hex(actual)
        }`,
    );
  }
}

/** Assert that `fn` throws (optionally matching `predicate`). */
export async function assertThrows(
  fn: () => unknown,
  predicate?: (err: unknown) => boolean,
  message = "expected function to throw",
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (predicate && !predicate(err)) {
      throw new Error(
        `threw, but predicate rejected the error: ${String(err)}`,
      );
    }
    return;
  }
  throw new Error(message);
}

/** Assert deep structural equality (JSON-comparable values). */
export function assertDeepEquals(
  actual: unknown,
  expected: unknown,
  message?: string,
): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      message ??
        `deep equality failed:\n  expected ${format(expected)}\n  actual   ${
          format(actual)
        }`,
    );
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    );
  }
  return false;
}

function format(value: unknown): string {
  if (value instanceof Uint8Array) return hex(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hex(bytes: Uint8Array): string {
  return "[" +
    Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ") +
    "]";
}

/** Run every registered test, print a report, and exit with an appropriate code. */
export async function runAll(): Promise<void> {
  let passed = 0;
  const failures: { name: string; error: unknown }[] = [];

  for (const t of registry) {
    try {
      await t.fn();
      passed++;
      log(`  ok   ${t.name}`);
    } catch (error) {
      failures.push({ name: t.name, error });
      log(`  FAIL ${t.name}`);
      log(
        `       ${
          error instanceof Error ? error.stack ?? error.message : String(error)
        }`,
      );
    }
  }

  log("");
  log(`${passed}/${registry.length} tests passed, ${failures.length} failed`);

  if (failures.length > 0) exit(1);
}

function log(message: string): void {
  // deno-lint-ignore no-console
  console.log(message);
}

function exit(code: number): void {
  const g = globalThis as {
    Deno?: { exit(code: number): never };
    process?: { exitCode?: number };
  };
  if (g.Deno) g.Deno.exit(code);
  else if (g.process) g.process.exitCode = code;
}
