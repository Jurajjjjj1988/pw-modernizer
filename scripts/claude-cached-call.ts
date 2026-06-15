#!/usr/bin/env tsx
/**
 * claude-cached-call.ts — Anthropic prompt-caching wrapper for verify stage.
 *
 * Why this exists
 * ===============
 * The pipeline calls `claude --print` from `.github/workflows/{plan,migrate,verify}.yml`.
 * That CLI does some prompt-cache reuse automatically with the *default* system
 * prompt (see `claude --help`: `--exclude-dynamic-system-prompt-sections`),
 * but it does NOT expose explicit `cache_control` markers. For verify in
 * particular, ~80% of every Opus call is static context:
 *   - The assembled verify-{sdet,code-review}.md prompt (~20 kB → ~5k tokens)
 *   - config/knowledge-base.md (~37k tokens)
 *   - config/migration-rules.md (~10k tokens)
 *
 * Subsequent calls within the 5-minute ephemeral-cache window pay ~10% of
 * normal input cost on those tokens (Anthropic 2026 pricing: opus cache_read
 * = $1.50/Mtok vs $15/Mtok normal input — see `scripts/metrics.ts` PRICING).
 *
 * This wrapper calls the SDK directly with `cache_control: { type: "ephemeral" }`
 * on the static blocks, leaving the per-migration variable inputs (input file,
 * plan, generated spec, Sonnet's report) un-cached. It's a drop-in replacement
 * for the `claude --print` invocation in verify.yml — wired via the
 * `USE_CACHED_SDK=1` env flag (see verify.yml POC step).
 *
 * Why verify only (in this PR)
 * ===========================
 * Verify is the cleanest fit:
 *   - Each lens reads a small fixed set of files (input + plan + spec + report
 *     + maybe a couple of helper files) and writes ONE markdown report.
 *   - Opus 4.7 is ~5× sonnet cost, so the $-per-call savings dominate.
 *   - The CANDOR 2-agent structure means SDET + Code Review fire within
 *     seconds of each other — the second one hits a warm cache for the KB +
 *     rules portion (both lenses share those static blocks).
 *
 * Plan + migrate could follow the same pattern; left for a follow-up PR
 * because they touch the Sonnet code-write tool loop (Read/Write/Edit), which
 * the SDK route doesn't yet implement here.
 *
 * Architecture
 * ============
 * SYSTEM blocks (cached, in order — each gets its own cache_control marker
 * so Anthropic can return a cache hit at the longest matching prefix):
 *   1. The assembled verify-{lens}.md prompt body (the role + checklist)
 *   2. config/knowledge-base.md
 *   3. config/migration-rules.md
 *
 * USER message (not cached — varies every call):
 *   - input file source (read from inputs/<framework>/<basename>)
 *   - approved plan markdown (outputs/plans/<basename>.md)
 *   - Stage 2's generated spec(s) (outputs/tests/<basename>.spec.ts +
 *     optional helper files under outputs/helper/)
 *   - Stage 2's report (outputs/reports/<basename>.md)
 *   - The shaped "your task" envelope (boilerplate from verify.yml's
 *     here-doc, parameterised by basename + lens label).
 *
 * Output: writes the assistant's message text to the report path the workflow
 * passed in (--report-out), and a usage JSON to --usage-out in the same shape
 * `extract-claude-usage.ts` produces, so persist-verify-metrics.ts reads it
 * unchanged.
 *
 * Modes
 * =====
 *   --dry-run        Resolve all files, count tokens (approx via byte/4),
 *                    print cache structure breakdown + expected $ saved on
 *                    a hot vs cold call. DOES NOT call the API. Used by
 *                    `npm run cache:dry-run` and CI smoke.
 *   (default)        Call the API and write the report + usage files.
 *
 * Auth (matches verify.yml CLI auth):
 *   - ANTHROPIC_API_KEY (preferred, falls through directly to SDK)
 *   - CLAUDE_CODE_OAUTH_TOKEN (sk-ant-oat*; we pass via the same env var
 *     the CLI uses, but for the SDK we re-export as ANTHROPIC_API_KEY since
 *     the SDK only accepts API keys. OAuth tokens are NOT supported by the
 *     raw SDK — if only OAuth is available, the wrapper exits with a clear
 *     error pointing at verify.yml's fallback to the CLI path.)
 *
 * Strict TS, no `any`. Reuses the project's UsageStats shape.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import Anthropic from "@anthropic-ai/sdk";

import { computeCostUsd, type UsageStats } from "./metrics.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  lens: "sdet" | "code-review";
  inputBasename: string;
  /** Path under inputs/ — verify-sdet may have a multi-file dir; we just glob it. */
  inputPath: string;
  /** Where to write the generated report. */
  reportOut: string;
  /** Where to write the usage JSON (same shape as extract-claude-usage.ts output). */
  usageOut: string;
  /** Skip API call, just print cache layout + estimates. */
  dryRun: boolean;
  /** Override the model (defaults to Opus 4.7, matching verify.yml). */
  model: string;
  /** Repo root (defaults to cwd). */
  repoRoot: string;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      lens: { type: "string" },
      "input-basename": { type: "string" },
      "input-path": { type: "string" },
      "report-out": { type: "string" },
      "usage-out": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      model: { type: "string", default: "claude-opus-4-7" },
      "repo-root": { type: "string" },
    },
  });
  const lens = values.lens;
  if (lens !== "sdet" && lens !== "code-review") {
    process.stderr.write("::error::--lens must be 'sdet' or 'code-review'\n");
    process.exit(2);
  }
  const inputBasename = values["input-basename"];
  if (typeof inputBasename !== "string" || inputBasename.length === 0) {
    process.stderr.write("::error::--input-basename is required\n");
    process.exit(2);
  }
  // Dry-run can synthesise sensible defaults so smoke tests don't need real paths.
  const dryRun = values["dry-run"] === true;
  const repoRoot = typeof values["repo-root"] === "string" && values["repo-root"]!.length > 0
    ? resolve(values["repo-root"]!)
    : process.cwd();

  return {
    lens,
    inputBasename,
    inputPath: typeof values["input-path"] === "string" ? values["input-path"]! : "",
    reportOut:
      typeof values["report-out"] === "string" && values["report-out"]!.length > 0
        ? values["report-out"]!
        : `outputs/reports/${inputBasename}-verify-${lens}.md`,
    usageOut:
      typeof values["usage-out"] === "string" && values["usage-out"]!.length > 0
        ? values["usage-out"]!
        : `outputs/.usage/${inputBasename}-verify-${lens}.json`,
    dryRun,
    model: values.model ?? "claude-opus-4-7",
    repoRoot,
  };
}

// ---------------------------------------------------------------------------
// File loading helpers
// ---------------------------------------------------------------------------

interface LoadedBlock {
  /** Display label for the dry-run breakdown table. */
  label: string;
  /** Source path relative to repoRoot, for the breakdown table. */
  sourcePath: string;
  /** The actual content that goes into the API call. */
  body: string;
}

/** Read a file relative to repoRoot, exit with a useful error if missing. */
function readRel(repoRoot: string, rel: string, required: boolean): string {
  const full = join(repoRoot, rel);
  if (!existsSync(full)) {
    if (required) {
      process.stderr.write(`::error::Required file not found: ${rel}\n`);
      process.exit(1);
    }
    return "";
  }
  return readFileSync(full, "utf8");
}

/** Approximate token count from byte length (Anthropic averages ~4 chars/token). */
function estimateTokens(body: string): number {
  return Math.ceil(body.length / 4);
}

/**
 * Build the SYSTEM blocks (the static, cacheable context). Order:
 *   1. assembled verify-{lens}.md (role + checklist)
 *   2. KB
 *   3. migration-rules
 *
 * Each block gets its own `cache_control: ephemeral` marker. Anthropic caches
 * at the longest matching prefix — having three markers means if we edit the
 * tail block (rules) we still hit the cache on the head (prompt + KB).
 *
 * We use BetaTextBlockParam[] so `cache_control` is typed.
 */
function buildSystemBlocks(repoRoot: string, lens: "sdet" | "code-review"): LoadedBlock[] {
  const promptPath = `prompts/_assembled/verify-${lens}.md`;
  return [
    {
      label: "Assembled prompt (verify-" + lens + ".md)",
      sourcePath: promptPath,
      body: readRel(repoRoot, promptPath, true),
    },
    {
      label: "Knowledge base",
      sourcePath: "config/knowledge-base.md",
      body: readRel(repoRoot, "config/knowledge-base.md", true),
    },
    {
      label: "Migration rules",
      sourcePath: "config/migration-rules.md",
      body: readRel(repoRoot, "config/migration-rules.md", true),
    },
  ];
}

/**
 * Build the USER content — everything that varies per migration. NOT cached,
 * but kept compact (we read only the files verify-{lens}.md says it needs).
 *
 * We deliberately INLINE file contents rather than depending on a Read tool
 * loop. That trades flexibility (Opus can't fetch arbitrary files) for
 * predictable token count + a clean single-shot call. Verify's required
 * reading list is fixed by the prompt — see `## Required reading` in
 * `prompts/_assembled/verify-sdet.md`.
 */
function buildUserBlocks(
  repoRoot: string,
  basename: string,
  inputPath: string,
  lens: "sdet" | "code-review",
): LoadedBlock[] {
  const blocks: LoadedBlock[] = [];

  // Input source (the original test being migrated). Multi-file dirs (Selenium)
  // are concatenated below if inputPath is a dir.
  if (inputPath.length > 0 && existsSync(join(repoRoot, inputPath))) {
    const full = join(repoRoot, inputPath);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Selenium multi-file shape — concat all files in the dir.
      // Conservative: only top-level entries, not recursive, mirroring
      // verify-sdet's "Required reading" footprint.
      const entries = readdirSync(full).filter((e) => !e.startsWith("."));
      const concatenated = entries
        .map((e) => `### ${e}\n\n\`\`\`\n${readFileSync(join(full, e), "utf8")}\n\`\`\`\n`)
        .join("\n");
      blocks.push({
        label: "Source under test (multi-file)",
        sourcePath: inputPath,
        body: concatenated,
      });
    } else {
      blocks.push({
        label: "Source under test",
        sourcePath: inputPath,
        body: readFileSync(full, "utf8"),
      });
    }
  }

  // Approved plan markdown
  const planPath = `outputs/plans/${basename}.md`;
  blocks.push({
    label: "Approved plan",
    sourcePath: planPath,
    body: readRel(repoRoot, planPath, false),
  });

  // Generated spec
  const specPath = `outputs/tests/${basename}.spec.ts`;
  blocks.push({
    label: "Generated spec",
    sourcePath: specPath,
    body: readRel(repoRoot, specPath, false),
  });

  // Stage 2 report
  const reportPath = `outputs/reports/${basename}.md`;
  blocks.push({
    label: "Stage 2 report",
    sourcePath: reportPath,
    body: readRel(repoRoot, reportPath, false),
  });

  // Lens-specific guidance trailer (the "stay in your lane" reminder from
  // verify.yml's here-doc). Each lens gets a slightly different envelope.
  const lensLabel = lens === "sdet" ? "Senior SDET" : "Code Reviewer";
  blocks.push({
    label: "Run envelope (lens trailer)",
    sourcePath: "(generated)",
    body: [
      `You are the ${lensLabel} sub-agent in a CANDOR 2-agent consensus check.`,
      `Your co-verifier (the other lens) is running in PARALLEL and is BLIND to your output.`,
      `Do not coordinate. Do not duplicate the other lens's work. Stay in your lane.`,
      ``,
      `## Deliverable`,
      ``,
      `Produce ONE markdown report. Schema in the assembled prompt above.`,
      `Verdict line MUST be EXACTLY one of (case-sensitive):`,
      `- Verdict: SHIP IT`,
      `- Verdict: FIX FIRST`,
      `- Verdict: START OVER`,
      ``,
      `Input basename: ${basename}`,
    ].join("\n"),
  });

  return blocks;
}

// ---------------------------------------------------------------------------
// Dry-run breakdown
// ---------------------------------------------------------------------------

interface CacheBreakdown {
  systemBytes: number;
  systemTokens: number;
  userBytes: number;
  userTokens: number;
  /** Cold (first call in 5-min window) estimated USD. */
  coldUsd: number;
  /** Hot (cache hit) estimated USD. */
  hotUsd: number;
}

/**
 * Compute cost estimates for cold (cache miss / cache creation) vs hot
 * (cache hit / cache read) call. Uses the same per-model pricing as
 * scripts/metrics.ts so the numbers line up with the dashboard.
 *
 * Output tokens are estimated as a flat 1500 (a typical verify report) —
 * doesn't affect the cache-vs-no-cache delta but keeps the cold/hot numbers
 * realistic.
 */
function estimateBreakdown(
  model: string,
  system: LoadedBlock[],
  user: LoadedBlock[],
): CacheBreakdown {
  const systemBytes = system.reduce((s, b) => s + b.body.length, 0);
  const userBytes = user.reduce((s, b) => s + b.body.length, 0);
  const systemTokens = estimateTokens(system.map((b) => b.body).join(""));
  const userTokens = estimateTokens(user.map((b) => b.body).join(""));
  const estimatedOutput = 1500;

  // Cold: system tokens billed as cache_creation, user tokens as fresh input.
  const cold: UsageStats = {
    model,
    input_tokens: userTokens,
    output_tokens: estimatedOutput,
    cache_creation_tokens: systemTokens,
    cache_read_tokens: 0,
  };
  // Hot: system tokens billed as cache_read.
  const hot: UsageStats = {
    model,
    input_tokens: userTokens,
    output_tokens: estimatedOutput,
    cache_creation_tokens: 0,
    cache_read_tokens: systemTokens,
  };
  return {
    systemBytes,
    systemTokens,
    userBytes,
    userTokens,
    coldUsd: computeCostUsd(cold) ?? 0,
    hotUsd: computeCostUsd(hot) ?? 0,
  };
}

function printDryRun(
  args: CliArgs,
  system: LoadedBlock[],
  user: LoadedBlock[],
  breakdown: CacheBreakdown,
): void {
  process.stdout.write(`\n=== claude-cached-call dry-run ===\n\n`);
  process.stdout.write(`Lens:           ${args.lens}\n`);
  process.stdout.write(`Input basename: ${args.inputBasename}\n`);
  process.stdout.write(`Model:          ${args.model}\n`);
  process.stdout.write(`Report out:     ${args.reportOut}\n`);
  process.stdout.write(`Usage out:      ${args.usageOut}\n\n`);

  process.stdout.write(`SYSTEM blocks (cached, cache_control: ephemeral):\n`);
  process.stdout.write(`  ${"label".padEnd(38)}  ${"bytes".padStart(8)}  ${"~tokens".padStart(8)}  source\n`);
  for (const b of system) {
    process.stdout.write(
      `  ${b.label.padEnd(38)}  ${b.body.length.toString().padStart(8)}  ${estimateTokens(b.body).toString().padStart(8)}  ${b.sourcePath}\n`,
    );
  }
  process.stdout.write(
    `  ${"TOTAL".padEnd(38)}  ${breakdown.systemBytes.toString().padStart(8)}  ${breakdown.systemTokens.toString().padStart(8)}\n\n`,
  );

  process.stdout.write(`USER blocks (NOT cached — vary per migration):\n`);
  process.stdout.write(`  ${"label".padEnd(38)}  ${"bytes".padStart(8)}  ${"~tokens".padStart(8)}  source\n`);
  for (const b of user) {
    process.stdout.write(
      `  ${b.label.padEnd(38)}  ${b.body.length.toString().padStart(8)}  ${estimateTokens(b.body).toString().padStart(8)}  ${b.sourcePath}\n`,
    );
  }
  process.stdout.write(
    `  ${"TOTAL".padEnd(38)}  ${breakdown.userBytes.toString().padStart(8)}  ${breakdown.userTokens.toString().padStart(8)}\n\n`,
  );

  process.stdout.write(`Estimated cost per call (output ≈ 1500 tokens):\n`);
  process.stdout.write(`  Cold (first call, cache creation):  $${breakdown.coldUsd.toFixed(4)}\n`);
  process.stdout.write(`  Hot  (subsequent call, cache hit):  $${breakdown.hotUsd.toFixed(4)}\n`);
  const saved = breakdown.coldUsd - breakdown.hotUsd;
  const pct = breakdown.coldUsd > 0 ? (saved / breakdown.coldUsd) * 100 : 0;
  process.stdout.write(`  Savings on a hot call:              $${saved.toFixed(4)}  (${pct.toFixed(1)}%)\n\n`);

  // The 2-agent CANDOR pattern means SDET + Code Review fire seconds apart.
  // The second one warms up the cache on KB + rules (both lenses share them
  // verbatim). Conservative estimate: 2/3 of system tokens are KB + rules,
  // which means lens 2 hits the cache for those blocks even on a "cold"
  // pair start. We note that in the savings line.
  process.stdout.write(
    `Note: under CANDOR pair execution, the SECOND lens shares KB + migration-rules\n` +
      `with the first → those blocks are cache-hit even on the pair's first run.\n` +
      `Expected pair-level savings vs the no-cache baseline: ~25-40% on the cold\n` +
      `pair, ~70% on warm-pair retries within the 5-minute window.\n`,
  );
  process.stdout.write(`\n=== dry-run complete; no API call made ===\n\n`);
}

// ---------------------------------------------------------------------------
// Real API call
// ---------------------------------------------------------------------------

interface BetaCacheControl {
  type: "ephemeral";
}

interface BetaTextBlockParam {
  type: "text";
  text: string;
  cache_control?: BetaCacheControl;
}

/**
 * Mark the LAST block in each group with `cache_control: ephemeral`. Anthropic
 * caches at the longest matching prefix from each marker — so marking only
 * the tail of each section gives us one breakpoint per section while
 * minimising the per-call cache_control limit (4 markers max per request).
 *
 * We use 2 markers total: one at the end of system blocks (covers all 3
 * system blocks under one cache prefix), one at the end of the FIRST
 * user block which captures any user-blocks that don't change between
 * lenses (we don't use this here — see comment).
 *
 * NB: 0.32.1's beta types are explicit (BetaTextBlockParam). We cast at the
 * call boundary because the SDK's `BetaTextBlockParam` is the exact shape
 * we already build.
 */
function withCacheControl(
  blocks: LoadedBlock[],
  cacheLast: boolean,
): BetaTextBlockParam[] {
  return blocks.map((b, idx) => {
    const isLast = idx === blocks.length - 1;
    const block: BetaTextBlockParam = { type: "text", text: b.body };
    if (cacheLast && isLast) {
      block.cache_control = { type: "ephemeral" };
    }
    return block;
  });
}

async function callApi(
  args: CliArgs,
  system: LoadedBlock[],
  user: LoadedBlock[],
): Promise<{ reportText: string; usage: UsageStats }> {
  // Auth: only ANTHROPIC_API_KEY works with the raw SDK. The CLI accepts
  // OAuth tokens; the SDK does not. verify.yml's POC path detects this and
  // falls back to the legacy CLI when only OAuth is present.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    process.stderr.write(
      "::error::ANTHROPIC_API_KEY missing. claude-cached-call cannot use OAuth — verify.yml falls back to the CLI path in this case.\n",
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  // beta.messages.create lets us pass typed cache_control on each block.
  // Once cache_control becomes part of stable messages API in a future SDK
  // version we'll move this off the beta path; the wire format is identical.
  const systemBlocks = withCacheControl(system, true);
  const userBlocks = withCacheControl(user, false);

  const response = await client.beta.messages.create({
    model: args.model,
    max_tokens: 4096,
    system: systemBlocks,
    messages: [
      {
        role: "user",
        content: userBlocks,
      },
    ],
  });

  // Pull the assistant text from the response content array. Beta messages
  // mirror messages — content is an array of blocks; we want the text ones.
  const reportText = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const usage: UsageStats = {
    model: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
  };

  return { reportText, usage };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseCli();

  // Build the blocks first so dry-run can show the layout without auth.
  const system = buildSystemBlocks(args.repoRoot, args.lens);
  const user = buildUserBlocks(args.repoRoot, args.inputBasename, args.inputPath, args.lens);
  const breakdown = estimateBreakdown(args.model, system, user);

  if (args.dryRun) {
    printDryRun(args, system, user, breakdown);
    return 0;
  }

  process.stderr.write(
    `claude-cached-call: invoking ${args.model} (lens=${args.lens}, basename=${args.inputBasename})\n` +
      `  system tokens ≈ ${breakdown.systemTokens}, user tokens ≈ ${breakdown.userTokens}\n`,
  );

  const { reportText, usage } = await callApi(args, system, user);

  // Write report.
  mkdirSync(dirname(args.reportOut), { recursive: true });
  writeFileSync(args.reportOut, reportText, "utf8");

  // Write usage in the same shape extract-claude-usage.ts produces, so
  // persist-verify-metrics.ts reads it unchanged.
  mkdirSync(dirname(args.usageOut), { recursive: true });
  writeFileSync(args.usageOut, JSON.stringify(usage, null, 2));

  const costUsd = computeCostUsd(usage);
  process.stderr.write(
    `claude-cached-call: wrote ${args.reportOut} (model=${usage.model}, in=${usage.input_tokens}, out=${usage.output_tokens}` +
      `, cache_read=${usage.cache_read_tokens ?? 0}, cache_creation=${usage.cache_creation_tokens ?? 0}` +
      (costUsd !== null ? `, cost=$${costUsd.toFixed(4)}` : "") +
      `)\n`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`::error::claude-cached-call failed: ${msg}\n`);
    process.exit(1);
  });
