/**
 * Executable-docs ratchet (zero dependencies, Deno-native).
 *
 * Extracts every fenced `ts` / `typescript` code block from the repository's
 * READMEs and type-checks each one against the **real** public API, so a
 * documentation example can never silently rot away from the code it documents.
 * A real API change that breaks a README snippet fails this check — and thus CI.
 *
 *   deno task check:docs-examples
 *   deno run -A scripts/check-docs-examples.ts          # check all READMEs
 *   deno run -A scripts/check-docs-examples.ts --list   # just list the blocks
 *
 * ## What is checked
 *
 * Only fenced blocks whose info string is `ts` or `typescript`. Shell (`bash`),
 * JSON, Rust, TOML and un-annotated blocks are ignored.
 *
 * ## Opting a block out
 *
 * A block that is deliberately illustrative — a partial fragment, a bare
 * interface sketch, pseudo-code — opts out by adding the `no-check` word to its
 * fence info string:
 *
 *     ```ts no-check
 *     // a fragment that is not meant to compile on its own
 *     ```
 *
 * Prefer fixing a block to compile against the real API over opting it out;
 * `no-check` is for snippets that are genuinely not standalone usage.
 *
 * ## How imports resolve (so drift is actually caught)
 *
 * Examples import from the published package names (`@momics/dns-sd-node`, …).
 * A generated Deno import map redirects each of those names to its **local
 * source entrypoint**, so the snippet is checked against this checkout's real
 * API rather than a published artifact:
 *
 *   - `@momics/dns-sd-shared`          → packages/dns-sd-shared/src/index.ts
 *   - `@momics/dns-sd-shared/testing`  → packages/dns-sd-shared/src/testing/index.ts
 *   - `@momics/dns-sd-deno`            → packages/dns-sd-deno/src/mod.ts
 *   - `@momics/dns-sd-node`            → packages/dns-sd-node/src/index.ts
 *   - `@momics/dns-sd-tauri`           → packages/dns-sd-tauri/guest-js/index.ts
 *
 * `node:*` built-ins resolve through Deno's Node compatibility layer. The Tauri
 * binding's one third-party dependency, `@tauri-apps/api`, is redirected to a
 * tiny local stub (`scripts/stubs/tauri-api-core.ts`) so the check never links
 * that package from npm. Because every target is the local source tree, renaming
 * or removing a public export makes the corresponding example fail here.
 *
 * ## Why the check runs from a temp dir inside the repo
 *
 * The generated config lives in a throwaway directory *under the repo root* and
 * is deliberately **not** a workspace member, so Deno ignores the root
 * `deno.json` (whose `nodeModulesDir: "none"` would otherwise forbid the Node
 * type-resolution the `@momics/dns-sd-node` examples need). It sets
 * `nodeModulesDir: "manual"` and symlinks the repo's `node_modules` (populated
 * by `npm ci`, which CI already runs before this step) so `@types/node` and the
 * Node built-ins resolve without any network access — the check is hermetic and
 * reproduces exactly under Deno 2.9's config-discovery rules.
 *
 * @module
 */

/** A README to scan, relative to the repository root. */
const READMES = [
  "README.md",
  "packages/dns-sd-shared/README.md",
  "packages/dns-sd-deno/README.md",
  "packages/dns-sd-node/README.md",
  "packages/dns-sd-tauri/README.md",
] as const;

/** The repository root, derived from this script's location (`<root>/scripts`). */
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Import map redirecting package names to their local source entrypoints,
 * expressed relative to the generated config (which lives one directory below
 * the repo root — see `main`).
 */
const IMPORTS: Record<string, string> = {
  "@momics/dns-sd-shared": "../packages/dns-sd-shared/src/index.ts",
  "@momics/dns-sd-shared/testing":
    "../packages/dns-sd-shared/src/testing/index.ts",
  "@momics/dns-sd-shared/testing/harness":
    "../packages/dns-sd-shared/src/testing/harness.ts",
  "@momics/dns-sd-shared/wire": "../packages/dns-sd-shared/src/wire/index.ts",
  "@momics/dns-sd-deno": "../packages/dns-sd-deno/src/mod.ts",
  "@momics/dns-sd-node": "../packages/dns-sd-node/src/index.ts",
  "@momics/dns-sd-tauri": "../packages/dns-sd-tauri/guest-js/index.ts",
  "@tauri-apps/api/core": "../scripts/stubs/tauri-api-core.ts",
};

/**
 * Compiler options for the extracted snippets: the union of every package's
 * `strict` settings and the libs they rely on (Deno, unstable UDP, the DOM for
 * the Tauri binding, and explicit-resource-management for `await using`).
 */
const COMPILER_OPTIONS = {
  lib: ["deno.window", "deno.ns", "deno.unstable", "dom", "esnext.disposable"],
  strict: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
};

/** One extracted fenced code block. */
interface Block {
  readonly file: string;
  /** 1-based line number of the opening fence. */
  readonly line: number;
  readonly lang: string;
  readonly noCheck: boolean;
  readonly code: string;
}

/** Extract the `ts` / `typescript` fenced blocks from one README's text. */
function extractBlocks(file: string, text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let open: { line: number; info: string; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(/^```(.*)$/);
    if (!fence) {
      if (open) open.body.push(line);
      continue;
    }
    if (!open) {
      open = { line: i + 1, info: (fence[1] ?? "").trim(), body: [] };
      continue;
    }
    // Closing fence: emit if it was a TS block.
    const words = open.info.split(/\s+/).filter(Boolean);
    const lang = words[0] ?? "";
    if (lang === "ts" || lang === "typescript") {
      blocks.push({
        file,
        line: open.line,
        lang,
        noCheck: words.includes("no-check"),
        code: open.body.join("\n"),
      });
    }
    open = null;
  }
  return blocks;
}

/** Type-check a single snippet with `deno check`; resolves with its output on failure. */
async function checkSnippet(
  configPath: string,
  code: string,
  tmpDir: string,
  index: number,
): Promise<{ ok: boolean; output: string }> {
  // A trailing `export {}` makes the file an isolated module, so top-level
  // `const` names in different snippets never collide and bare snippets are
  // still treated as modules (enabling top-level `await` / `import`).
  const filePath = `${tmpDir}/block_${index}.ts`;
  await Deno.writeTextFile(filePath, `${code}\nexport {};\n`);
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["check", "--config", configPath, filePath],
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stdout, stderr } = await cmd.output();
  const output = new TextDecoder().decode(stderr) +
    new TextDecoder().decode(stdout);
  return { ok: success, output };
}

/**
 * The checker needs Deno >= 2.9: it runs each snippet against a throwaway
 * config placed *under the repo root but outside the workspace*, and only Deno
 * 2.9+ ignores such a non-member config. Older Deno instead rejects it ("Config
 * file must be a member of the workspace"), so every block would fail with a
 * spurious config error rather than a real type check. Fail fast with an
 * actionable message instead.
 */
function assertDenoVersion(): void {
  const parts = Deno.version.deno.split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  if (major < 2 || (major === 2 && minor < 9)) {
    console.error(
      `check:docs-examples requires Deno >= 2.9 due to workspace ` +
        `config-discovery behavior (running ${Deno.version.deno}).\n` +
        `Upgrade with \`deno upgrade\`; CI pins deno-version: v2.9.`,
    );
    Deno.exit(1);
  }
}

async function main() {
  assertDenoVersion();
  const listOnly = Deno.args.includes("--list");

  const allBlocks: Block[] = [];
  for (const rel of READMES) {
    const text = await Deno.readTextFile(`${ROOT}/${rel}`);
    allBlocks.push(...extractBlocks(rel, text));
  }

  if (listOnly) {
    for (const b of allBlocks) {
      const tag = b.noCheck ? "skip (no-check)" : "check";
      console.log(`${b.file}:${b.line}\t${b.lang}\t${tag}`);
    }
    const checked = allBlocks.filter((b) => !b.noCheck).length;
    console.log(
      `\n${allBlocks.length} TS block(s): ${checked} checked, ${
        allBlocks.length - checked
      } opted out.`,
    );
    return;
  }

  // A throwaway config directory *under the repo root*. Being a non-workspace
  // sibling of the root `deno.json` makes Deno ignore the workspace config
  // (whose `nodeModulesDir: "none"` would forbid the Node type-resolution the
  // node-runtime examples need). We symlink the repo's `node_modules` — already
  // populated by `npm ci` in CI — so `@types/node` resolves offline.
  const tmpDir = await Deno.makeTempDir({ dir: ROOT, prefix: ".docs-check-" });
  await Deno.symlink(`${ROOT}/node_modules`, `${tmpDir}/node_modules`);
  const configPath = `${tmpDir}/deno.json`;
  await Deno.writeTextFile(
    configPath,
    JSON.stringify(
      {
        // Use the symlinked node_modules (never auto-install / hit the network).
        nodeModulesDir: "manual",
        compilerOptions: COMPILER_OPTIONS,
        imports: IMPORTS,
      },
      null,
      2,
    ),
  );

  let checked = 0;
  let skipped = 0;
  const failures: { block: Block; output: string }[] = [];

  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i]!;
    if (block.noCheck) {
      skipped++;
      continue;
    }
    checked++;
    const { ok, output } = await checkSnippet(
      configPath,
      block.code,
      tmpDir,
      i,
    );
    const where = `${block.file}:${block.line}`;
    if (ok) {
      console.log(`  ok   ${where}`);
    } else {
      console.log(`  FAIL ${where}`);
      failures.push({ block, output });
    }
  }

  await Deno.remove(tmpDir, { recursive: true });

  console.log(
    `\n${checked} block(s) checked, ${skipped} opted out, ${failures.length} failed.`,
  );

  if (failures.length > 0) {
    console.error("\nExecutable-docs check failed:\n");
    for (const { block, output } of failures) {
      console.error(`── ${block.file}:${block.line} ──`);
      console.error(block.code);
      console.error("\n" + output.trim() + "\n");
    }
    console.error(
      "Fix the snippet to use the real public API, or mark it `no-check` if it\n" +
        "is a deliberately illustrative fragment (see scripts/check-docs-examples.ts).",
    );
    Deno.exit(1);
  }

  console.log(
    "All executable README examples type-check against the real API.",
  );
}

await main();
