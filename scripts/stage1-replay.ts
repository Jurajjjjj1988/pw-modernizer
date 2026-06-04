#!/usr/bin/env node
/**
 * stage1-replay.ts — local replay cache for Stage 1 (analyze) plans, so that
 * iterating on prompts doesn't burn the Claude session quota.
 *
 * Why this exists: Stage 1 runs Claude via `claude --print` in
 * `.github/workflows/plan.yml`. Each invocation eats quota. Re-running the
 * same (input, prompt, feedback) tuple — common while iterating on
 * `prompts/analyze.md` — re-prompts Claude even though the output is
 * deterministic-enough to reuse. This script keeps a local hash-keyed cache
 * of `(plan.md, plan.envelope.json)` artifacts so a developer can answer
 * the question "did this exact prompt over this exact input already
 * produce a plan?" without ever leaving the shell.
 *
 * Scope: cache management ONLY. The script never invokes Claude. The
 * existing workflow / shell still calls `claude --print`; this script just
 * wraps that call with a lookup-first, write-after pattern.
 *
 * Cache layout:
 *
 *   outputs/.stage1-cache/
 *     README.md                  ← 1-paragraph explainer, created on first write
 *     <sha256>/
 *       plan.md                  ← cached plan body
 *       plan.envelope.json       ← cached structured envelope
 *       meta.json                ← { inputBasename, inputBytes, promptBytes,
 *                                    feedbackBytes, createdAt, source }
 *
 * Cache key = SHA-256 over:
 *   1. literal "input:" + length-prefixed input bytes (single file or
 *      deterministically concatenated directory tree)
 *   2. literal "prompt:" + length-prefixed prompt bytes
 *   3. literal "feedback:" + length-prefixed feedback bytes ("" when absent)
 *
 * The length prefixes prevent "concatenation collisions" — e.g. an input
 * that happens to end with the literal bytes "prompt:" + the rest of the
 * prompt would otherwise collide with a different (input, prompt) split.
 * Mirrors the pattern already used in `scripts/build-inventory.ts`
 * (`rel + " " + len + " " + body + " "`).
 *
 * CLI (lookup mode — default):
 *
 *   npx tsx scripts/stage1-replay.ts \
 *     --input    inputs/bad-playwright/flaky-waits.spec.ts \
 *     --prompt   prompts/_assembled/analyze.md \
 *     --output   outputs/plans/flaky-waits.spec.ts.md \
 *     --envelope outputs/plans/flaky-waits.spec.ts.envelope.json \
 *     [--feedback "the previous plan missed the loop conditional"] \
 *     [--force-fresh]
 *
 *   Exit 0 = cache hit. Artifacts copied to --output / --envelope paths.
 *   Exit 1 = cache miss. Caller should now invoke Claude themselves.
 *
 * CLI (write-cache mode — after a successful Claude run):
 *
 *   npx tsx scripts/stage1-replay.ts \
 *     --input ... --prompt ... --output ... --envelope ... \
 *     [--feedback "..."] \
 *     --write-cache
 *
 *   Reads the freshly written --output and --envelope files and persists
 *   them under the cache hash for next time. Exit 0 on success.
 *
 * Exit codes:
 *   0 — cache hit (lookup) OR cache write succeeded (write-cache)
 *   1 — cache miss (lookup) — caller should invoke Claude
 *   2 — script error (missing required arg, missing file, bad CLI)
 *
 * Intentional non-goals:
 *   - Eviction. The cache is local-only and never committed (.gitignored).
 *     A developer who wants to nuke it runs `rm -rf outputs/.stage1-cache`.
 *   - Locking. Single-developer local cache; concurrent writes would
 *     overwrite, which is acceptable since the inputs that produced them
 *     are identical by definition.
 *   - Workflow modification. The script is standalone so it can be
 *     adopted incrementally; `.github/workflows/plan.yml` stays untouched.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CACHE_ROOT = join(REPO_ROOT, "outputs", ".stage1-cache");
const CACHE_README_PATH = join(CACHE_ROOT, "README.md");

/**
 * Extensions hashed when --input points at a directory. Matches the source
 * frameworks the pipeline currently supports: bad-Playwright (.ts),
 * Cypress (.js/.ts), Selenium Java (.java), Selenium Python (.py).
 * Other files (.md, .json, images, etc.) are excluded so a stray README
 * doesn't shift the cache key.
 */
const INPUT_FILE_EXTENSIONS = [".ts", ".js", ".java", ".py"];

const CACHE_README_BODY = `# Stage 1 replay cache

This directory is managed by \`scripts/stage1-replay.ts\`. Each subdirectory
is a SHA-256 hash of (input + prompt + optional feedback) and contains the
\`plan.md\` + \`plan.envelope.json\` + \`meta.json\` that a Claude Stage 1 run
produced for that tuple. The cache lets a developer iterate on prompts /
inputs locally without re-prompting Claude when the key is unchanged.

The whole directory is git-ignored. Delete it (\`rm -rf outputs/.stage1-cache\`)
to force a full cold-cache run on the next iteration. The pipeline itself
(\`.github/workflows/plan.yml\`) is unchanged — this cache is local-only.
`;

interface Args {
  input: string;
  prompt: string;
  output: string;
  envelope: string;
  feedback: string;
  writeCache: boolean;
  forceFresh: boolean;
}

interface HashInputs {
  inputBytes: number;
  promptBytes: number;
  feedbackBytes: number;
  inputDigestSource: string;
}

interface MetaPayload {
  inputBasename: string;
  inputBytes: number;
  promptBytes: number;
  feedbackBytes: number;
  createdAt: string;
  source: "stage1-replay";
}

function fail(message: string): never {
  process.stderr.write(`stage1-replay: ${message}\n`);
  process.exit(2);
}

function parseCliArgs(): Args {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        input: { type: "string" },
        prompt: { type: "string" },
        output: { type: "string" },
        envelope: { type: "string" },
        feedback: { type: "string", default: "" },
        "write-cache": { type: "boolean", default: false },
        "force-fresh": { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch (err) {
    return fail(`bad CLI: ${(err as Error).message}`);
  }
  const v = parsed.values;
  const missing: string[] = [];
  if (v.input === undefined) missing.push("--input");
  if (v.prompt === undefined) missing.push("--prompt");
  if (v.output === undefined) missing.push("--output");
  if (v.envelope === undefined) missing.push("--envelope");
  if (missing.length > 0) {
    return fail(`missing required flag(s): ${missing.join(", ")}`);
  }
  const writeCache = v["write-cache"] === true;
  const forceFresh = v["force-fresh"] === true;
  if (writeCache && forceFresh) {
    return fail("--write-cache and --force-fresh are mutually exclusive");
  }
  return {
    input: resolve(v.input as string),
    prompt: resolve(v.prompt as string),
    output: resolve(v.output as string),
    envelope: resolve(v.envelope as string),
    feedback: (v.feedback as string) ?? "",
    writeCache,
    forceFresh,
  };
}

/**
 * Walk a directory and return every file under it whose extension is in
 * INPUT_FILE_EXTENSIONS. Paths are absolute; the caller sorts them by
 * repo-relative path before hashing to keep the digest stable across
 * filesystem traversal orders (APFS vs ext4 readdir order differs).
 */
function walkInputDir(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile()) continue;
      const lower = name.toLowerCase();
      if (INPUT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Build the deterministic byte stream that represents the input portion of
 * the cache key. Mirrors `computeSourceHash` in `scripts/build-inventory.ts`
 * — for each file we emit `<repo-rel-path> <byteLength> <body><space>` so
 * a rename, content edit, or empty-file addition all shift the digest.
 *
 * For a single-file input we still use the same framing (one entry) so the
 * single-file and directory paths produce identical hashes when given the
 * same set of bytes under the same names.
 */
function buildInputDigestSource(inputPath: string): {
  digestPayload: Buffer;
  totalBytes: number;
} {
  let st;
  try {
    st = statSync(inputPath);
  } catch {
    fail(`--input not found: ${inputPath}`);
  }
  const files = st.isDirectory() ? walkInputDir(inputPath) : [inputPath];
  if (files.length === 0) {
    fail(`--input directory contained no .ts/.js/.java/.py files: ${inputPath}`);
  }
  // Sort by repo-relative path so the digest is independent of readdir order.
  const sorted = files
    .map((abs) => ({ abs, rel: relative(REPO_ROOT, abs) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for (const { abs, rel } of sorted) {
    let body: Buffer;
    try {
      body = readFileSync(abs);
    } catch (err) {
      return fail(`cannot read input file ${abs}: ${(err as Error).message}`);
    }
    totalBytes += body.length;
    chunks.push(Buffer.from(`${rel} ${body.length} `, "utf8"));
    chunks.push(body);
    chunks.push(Buffer.from(" ", "utf8"));
  }
  return { digestPayload: Buffer.concat(chunks), totalBytes };
}

/**
 * Hash construction:
 *
 *   sha256(
 *     "input:"    + len(inputPayload)    + " " + inputPayload    +
 *     "prompt:"   + len(promptBytes)     + " " + promptBytes     +
 *     "feedback:" + len(feedbackBytes)   + " " + feedbackBytes
 *   )
 *
 * The literal section markers + length prefixes are belt-and-suspenders
 * against concatenation collisions (Joux 2004) — without them, shifting
 * one byte from the input into the prompt would produce an identical
 * pre-hash buffer.
 */
function computeCacheKey(args: Args): { key: string; inputs: HashInputs } {
  const { digestPayload: inputPayload, totalBytes: inputBytes } =
    buildInputDigestSource(args.input);

  let promptBuf: Buffer;
  try {
    promptBuf = readFileSync(args.prompt);
  } catch (err) {
    fail(`cannot read --prompt: ${args.prompt} (${(err as Error).message})`);
  }
  const feedbackBuf = Buffer.from(args.feedback, "utf8");

  const hash = createHash("sha256");
  hash.update(`input:${inputPayload.length} `);
  hash.update(inputPayload);
  hash.update(`prompt:${promptBuf.length} `);
  hash.update(promptBuf);
  hash.update(`feedback:${feedbackBuf.length} `);
  hash.update(feedbackBuf);

  return {
    key: hash.digest("hex"),
    inputs: {
      inputBytes,
      promptBytes: promptBuf.length,
      feedbackBytes: feedbackBuf.length,
      inputDigestSource: `${inputPayload.length}B (${args.input})`,
    },
  };
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function inputBasename(inputPath: string): string {
  // For directory inputs, the basename of the dir is the most useful
  // human-readable handle in meta.json. For files, the filename itself.
  return inputPath.split("/").filter(Boolean).pop() ?? inputPath;
}

function lookup(args: Args, key: string): boolean {
  const cacheDir = join(CACHE_ROOT, key);
  const planPath = join(cacheDir, "plan.md");
  const envelopePath = join(cacheDir, "plan.envelope.json");
  if (!existsSync(planPath) || !existsSync(envelopePath)) {
    return false;
  }
  ensureDir(dirname(args.output));
  ensureDir(dirname(args.envelope));
  try {
    copyFileSync(planPath, args.output);
    copyFileSync(envelopePath, args.envelope);
  } catch (err) {
    fail(`failed to copy cached artifacts: ${(err as Error).message}`);
  }
  process.stdout.write(
    `stage1-replay: cache hit ${key.slice(0, 12)}… → ${relative(REPO_ROOT, args.output)} + ${relative(REPO_ROOT, args.envelope)}\n`,
  );
  return true;
}

function write(args: Args, key: string, hashInputs: HashInputs): void {
  if (!existsSync(args.output)) {
    fail(`--write-cache requires --output to exist: ${args.output}`);
  }
  if (!existsSync(args.envelope)) {
    fail(`--write-cache requires --envelope to exist: ${args.envelope}`);
  }
  ensureDir(CACHE_ROOT);
  // First-write README. Cheap to re-check; idempotent.
  if (!existsSync(CACHE_README_PATH)) {
    writeFileSync(CACHE_README_PATH, CACHE_README_BODY, "utf8");
  }
  const cacheDir = join(CACHE_ROOT, key);
  ensureDir(cacheDir);
  const planPath = join(cacheDir, "plan.md");
  const envelopePath = join(cacheDir, "plan.envelope.json");
  const metaPath = join(cacheDir, "meta.json");
  try {
    copyFileSync(args.output, planPath);
    copyFileSync(args.envelope, envelopePath);
  } catch (err) {
    fail(`failed to write cache artifacts: ${(err as Error).message}`);
  }
  const meta: MetaPayload = {
    inputBasename: inputBasename(args.input),
    inputBytes: hashInputs.inputBytes,
    promptBytes: hashInputs.promptBytes,
    feedbackBytes: hashInputs.feedbackBytes,
    createdAt: new Date().toISOString(),
    source: "stage1-replay",
  };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  process.stdout.write(
    `stage1-replay: cache write ${key.slice(0, 12)}… (${hashInputs.inputBytes}B input + ${hashInputs.promptBytes}B prompt + ${hashInputs.feedbackBytes}B feedback)\n`,
  );
}

function emitMiss(args: Args, key: string, hashInputs: HashInputs): void {
  process.stdout.write(
    `stage1-replay: cache miss ${key} ` +
      `(input=${hashInputs.inputBytes}B prompt=${hashInputs.promptBytes}B feedback=${hashInputs.feedbackBytes}B)\n`,
  );
  process.stdout.write(
    `stage1-replay: next step — invoke Claude (e.g. \`claude --print < ${relative(REPO_ROOT, args.prompt)}\`), ` +
      `write plan to ${relative(REPO_ROOT, args.output)} + envelope to ${relative(REPO_ROOT, args.envelope)}, ` +
      `then re-run this command with --write-cache to seed the entry.\n`,
  );
}

function main(): void {
  const args = parseCliArgs();
  const { key, inputs } = computeCacheKey(args);

  if (args.writeCache) {
    write(args, key, inputs);
    process.exit(0);
  }

  if (args.forceFresh) {
    process.stdout.write(
      `stage1-replay: --force-fresh — bypassing cache for ${key.slice(0, 12)}…\n`,
    );
    emitMiss(args, key, inputs);
    process.exit(1);
  }

  if (lookup(args, key)) {
    process.exit(0);
  }
  emitMiss(args, key, inputs);
  process.exit(1);
}

main();
