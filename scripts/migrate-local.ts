#!/usr/bin/env tsx
/**
 * migrate-local.ts — run Stage 2 (generate) locally, on YOUR own test file,
 * without forking the repo or wiring GitHub Actions secrets.
 *
 * This is the "clone & use" entry point: it mirrors `.github/workflows/migrate.yml`
 * exactly — same assembled prompt, same inventory grounding, same Claude model +
 * flags, and the SAME post-generate validator wall — so a local run gates output
 * the way CI does. The authoritative gate is still CI; this catches the
 * deterministic failures before you ever push.
 *
 * Prerequisite: an approved Stage-1 plan must already exist for the input
 * (run plan.yml, or `npm run try-it` for the demo). Stage 2 executes the plan;
 * it does not re-plan.
 *
 * Usage:
 *   npm run migrate -- --input inputs/bad-playwright/foo.spec.ts
 *   npm run migrate -- --input <path> --plan outputs/plans/foo.spec.ts.md
 *   npm run migrate -- --input <path> --mock   # wiring check, no Claude call
 *   npm run migrate -- --help
 *
 * Auth (one of, same as try-it):
 *   CLAUDE_CODE_OAUTH_TOKEN   (`claude setup-token`, Claude Pro/Max)
 *   ANTHROPIC_API_KEY         (https://console.anthropic.com/)
 *
 * Exit codes: 0 = generated + validator wall clean, 1 = setup error or a
 * validator failed (review the printed wall before trusting the output).
 */

import { execSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const ASSEMBLED_GENERATE = join(REPO_ROOT, "prompts/_assembled/generate.md");
const INVENTORY_PATH = join(REPO_ROOT, "outputs/.snippets-inventory.md");
const OUT_DIR = join(REPO_ROOT, "outputs/tests");

interface Args { input: string; plan: string; mock: boolean; help: boolean }
interface Paths { input: string; base: string; plan: string; envelope: string; report: string }
interface Auth { kind: "oauth" | "api" | "none"; value: string }
interface WallStep { name: string; cmd: string; args: string[] }
interface WallResult { name: string; ok: boolean; detail: string }

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      plan: { type: "string" },
      mock: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  return {
    input: values.input ?? "",
    plan: values.plan ?? "",
    mock: values.mock === true,
    help: values.help === true,
  };
}

function printHelp(): void {
  process.stdout.write([
    "migrate — run Stage 2 (generate clean Playwright) on your own test, locally.",
    "",
    "Usage:",
    "  npm run migrate -- --input <path>            generate (needs auth + an approved plan)",
    "  npm run migrate -- --input <path> --plan <p> explicit plan path",
    "  npm run migrate -- --input <path> --mock     wiring check, no Claude call",
    "  npm run migrate -- --help",
    "",
    "Auth (one of):",
    "  CLAUDE_CODE_OAUTH_TOKEN    `claude setup-token` (Claude Pro/Max)",
    "  ANTHROPIC_API_KEY          https://console.anthropic.com/",
    "",
    "Plan: defaults to outputs/plans/<input-filename>.md — run Stage 1 (plan.yml",
    "or `npm run try-it` for the demo) first if it does not exist.",
    "",
  ].join("\n"));
}

/** Resolve every derived path the way migrate.yml does (BASE = basename(input)). */
function derivePaths(args: Args): Paths {
  const input = resolve(REPO_ROOT, args.input);
  const base = basename(input);
  const plan = args.plan
    ? resolve(REPO_ROOT, args.plan)
    : join(REPO_ROOT, "outputs/plans", `${base}.md`);
  return {
    input,
    base,
    plan,
    envelope: join(REPO_ROOT, "outputs/plans", `${base}.envelope.json`),
    report: join(REPO_ROOT, "outputs/reports", `${base}.md`),
  };
}

function detectAuth(): Auth {
  const oauth = (process.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  const api = (process.env["ANTHROPIC_API_KEY"] ?? "").trim();
  if (oauth.length > 0) return { kind: "oauth", value: oauth };
  if (api.length > 0) return { kind: "api", value: api };
  return { kind: "none", value: "" };
}

function fail(msg: string): never {
  process.stderr.write(`\n  ERROR: ${msg}\n\n`);
  process.exit(1);
}

/** Regenerate assembled prompts + the reuse inventory, exactly as migrate.yml does. */
function prepareContext(): void {
  process.stdout.write("  [step] assemble prompts + build inventory ... ");
  execSync("npx tsx scripts/assemble-prompts.ts --write", { cwd: REPO_ROOT, stdio: "pipe" });
  execSync(`npx tsx scripts/build-inventory.ts --out ${JSON.stringify(INVENTORY_PATH)}`, {
    cwd: REPO_ROOT, stdio: "pipe",
  });
  process.stdout.write("ok\n");
}

/** Derive the plan envelope (Stage 1 -> Stage 2 contract) the way migrate.yml does. */
function deriveEnvelope(p: Paths): void {
  process.stdout.write("  [step] derive plan envelope ... ");
  const r = spawnSync("npx", [
    "tsx", "scripts/derive-envelope.ts", "--plan", p.plan, "--out", p.envelope,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  if (r.status !== 0) fail(`derive-envelope failed:\n${r.stderr ?? r.stdout ?? ""}`);
  process.stdout.write("ok\n");
}

/** The Stage-2 wrapper prompt — points Claude at the assembled spec + context, mirroring migrate.yml. */
function buildPrompt(p: Paths): string {
  return [
    "You are running Stage 2 of the PWmodernizer pipeline (local migrate run).",
    "",
    "Read prompts/_assembled/generate.md — that is your full system prompt. Follow it",
    "exactly, including the STOP block: write the FULL qa-master triad (spec under",
    "outputs/tests/<kebab>.spec.ts importing test/expect from @fixtures/base.fixture,",
    "the PageClass under outputs/helper/page-object/pages/, and the extended",
    "base.fixture) plus any helper layers the plan declares. A spec that imports from",
    "@playwright/test or uses raw `page`/`page.goto` is HARD-REJECTED by the validator.",
    "",
    "## Inputs for this run",
    `- Approved plan (execute it; do not re-plan): ${p.plan}`,
    `- Plan envelope (machine contract): ${p.envelope}`,
    `- Original input (preserve assertion behaviour): ${p.input}`,
    `- Reuse inventory (prefer existing helpers over new): ${INVENTORY_PATH}`,
    "",
    "## Context to load (in this order)",
    "1. prompts/_assembled/generate.md — task spec (READ FIRST)",
    "2. config/migration-rules.md + config/knowledge-base.md — rules + KB IDs",
    "3. examples/reference/qa-master/ — style anchor",
    `4. ${p.plan} and ${p.input}`,
    "",
    `Write a migration report to ${p.report} per the report schema.`,
  ].join("\n");
}

/** Invoke the Claude Code CLI with the Stage-2 budget + flags (mirrors migrate.yml). */
function runClaude(auth: Auth, prompt: string): void {
  const billedTo = auth.kind === "oauth" ? "Claude subscription" : "Anthropic API key";
  process.stdout.write(`  ⚠ This calls Claude (model claude-sonnet-4-6, up to 50 turns) and spends tokens on your ${billedTo}.\n`);
  process.stdout.write("  [step] call Claude (Stage 2, claude-sonnet-4-6, max-turns 50) ... ");
  const env = { ...process.env };
  if (auth.kind === "oauth") { env["CLAUDE_CODE_OAUTH_TOKEN"] = auth.value; delete env["ANTHROPIC_API_KEY"]; }
  else { env["ANTHROPIC_API_KEY"] = auth.value; delete env["CLAUDE_CODE_OAUTH_TOKEN"]; }
  const r = spawnSync("npx", [
    "--yes", "@anthropic-ai/claude-code",
    "--model", "claude-sonnet-4-6",
    "--max-turns", "50",
    "--print",
    "--permission-mode", "acceptEdits",
    prompt,
  ], { cwd: REPO_ROOT, env, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) fail("Claude generate call failed — see output above.");
  process.stdout.write("  [step] Claude generate done\n");
}

/** The post-generate validator wall — same scripts + args as migrate.yml. */
function validatorWall(p: Paths): WallStep[] {
  return [
    { name: "tsc (outputs/tests)", cmd: "npx", args: ["tsc", "--noEmit", "-p", "outputs/tests/tsconfig.json"] },
    { name: "eslint --fix", cmd: "npx", args: ["eslint", "--fix", "outputs/tests/**/*.ts"] },
    { name: "ast-diff-not-trivial", cmd: "npx", args: ["tsx", "scripts/ast-diff-trivial-check.ts", "--input", p.input, "--output", "outputs/tests"] },
    { name: "plan-envelope coverage", cmd: "npx", args: ["tsx", "scripts/plan-envelope-validate.ts", "--envelope", p.envelope, "--code", "outputs/tests"] },
    { name: "plan-code coverage", cmd: "npx", args: ["tsx", "scripts/plan-code-coverage.ts", "--envelope", p.envelope, "--output", "outputs/tests"] },
    { name: "helper-usage", cmd: "npx", args: ["tsx", "scripts/validate-helper-usage.ts"] },
    { name: "qa-master conformance", cmd: "npx", args: ["tsx", "scripts/validate-qa-master-conformance.ts", "--root", "outputs", "--input-basename", p.base] },
    { name: "TODO discipline", cmd: "npx", args: ["tsx", "scripts/validate-todo-discipline.ts", "--root", "outputs/tests", "--root", "outputs/helper"] },
    { name: "report metrics", cmd: "npx", args: ["tsx", "scripts/validate-report-metrics.ts", "--report", p.report, "--input", p.input] },
  ];
}

/** Run every wall step, collect pass/fail (non-fatal until the summary). */
function runWall(steps: WallStep[]): WallResult[] {
  const results: WallResult[] = [];
  for (const s of steps) {
    process.stdout.write(`  [gate] ${s.name} ... `);
    const r: SpawnSyncReturns<string> = spawnSync(s.cmd, s.args, { cwd: REPO_ROOT, encoding: "utf8" });
    const ok = r.status === 0;
    process.stdout.write(ok ? "pass\n" : "FAIL\n");
    const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ");
    results.push({ name: s.name, ok, detail: ok ? "" : tail });
  }
  return results;
}

/** Locate the generated spec the way migrate.yml does — first *.spec.ts under outputs/tests, excluding the v0.1.x archive. */
function findGeneratedSpec(): string | null {
  if (!existsSync(OUT_DIR)) return null;
  const stack = [OUT_DIR];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_legacy-v0.1.x") stack.push(full);
      } else if (entry.name.endsWith(".spec.ts")) {
        return full;
      }
    }
  }
  return null;
}

/** Run evaluate.ts → aggregate confidence (0..1) + write the metrics report (mirrors migrate.yml). */
function runEvaluate(p: Paths, spec: string): string | null {
  const args = [
    "tsx", "scripts/evaluate.ts",
    "--input", p.input, "--plan", p.plan, "--output", spec, "--report-out", p.report,
  ];
  const usage = join(REPO_ROOT, "outputs/.usage", `${p.base}-migration.json`);
  if (existsSync(usage)) args.push("--usage", usage);
  const r = spawnSync("npx", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (r.status !== 0) return null;
  const out = (r.stdout ?? "").trim().split("\n").filter((l) => l.trim().length > 0);
  return out.length > 0 ? out[out.length - 1] ?? null : null;
}

function main(): number {
  const args = parseCliArgs();
  if (args.help) { printHelp(); return 0; }
  if (!args.input) { printHelp(); fail("--input <path> is required."); }

  const p = derivePaths(args);
  if (!existsSync(p.input)) fail(`input not found: ${p.input}`);
  if (!existsSync(p.plan)) {
    fail(`no approved plan at ${p.plan}\n  Run Stage 1 first (plan.yml, or \`npm run try-it\` for the demo).`);
  }
  for (const d of [OUT_DIR, dirname(p.report)]) mkdirSync(d, { recursive: true });

  process.stdout.write(`\n  migrate — ${p.base}\n\n`);
  // In --mock, derive the envelope to a throwaway temp path so a wiring check
  // never mutates a committed outputs/plans/<base>.envelope.json.
  if (args.mock) p.envelope = join(tmpdir(), `pwm-mock-${p.base}.envelope.json`);
  prepareContext();
  deriveEnvelope(p);

  if (args.mock) {
    process.stdout.write("\n  [mock] wiring OK. Would invoke:\n");
    process.stdout.write("    npx @anthropic-ai/claude-code --model claude-sonnet-4-6 --max-turns 50 \\\n");
    process.stdout.write("      --print --permission-mode acceptEdits \"<stage-2 prompt>\"\n");
    process.stdout.write(`\n  Re-run without --mock (and with auth set) to generate.\n\n`);
    return 0;
  }

  const auth = detectAuth();
  if (auth.kind === "none") {
    fail("no Claude auth. Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY (see --help). Or --mock to check wiring.");
  }
  runClaude(auth, buildPrompt(p));

  process.stdout.write("\n  Validator wall (mirrors CI; CI remains authoritative):\n");
  const results = runWall(validatorWall(p));
  return reportOutcome(p, results);
}

/** Print the wall results + confidence score; return the process exit code. */
function reportOutcome(p: Paths, results: WallResult[]): number {
  const failed = results.filter((r) => !r.ok);
  // Confidence (informational — same evaluate.ts CI uses to decide if verify fires).
  const spec = findGeneratedSpec();
  const confidence = spec ? runEvaluate(p, spec) : null;

  process.stdout.write("\n  Summary:\n");
  for (const r of results) {
    const detail = r.detail ? ` — ${r.detail}` : "";
    process.stdout.write(`    ${r.ok ? "✓" : "✗"} ${r.name}${detail}\n`);
  }
  if (confidence !== null) {
    const verdict = Number(confidence) < 0.7 ? " (< 0.7 → CI would run Opus verify)" : " (≥ 0.7 → CI ships without verify)";
    process.stdout.write(`    confidence: ${confidence}${verdict}\n`);
    process.stdout.write(`    metrics report: ${p.report}\n`);
  }
  if (failed.length > 0) {
    process.stdout.write(`\n  ${failed.length} gate(s) failed — review before trusting the output.\n\n`);
    return 1;
  }
  process.stdout.write("\n  All gates passed. Review the output, then commit.\n\n");
  return 0;
}

process.exit(main());
