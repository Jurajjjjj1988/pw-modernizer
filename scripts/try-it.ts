#!/usr/bin/env tsx
/**
 * try-it.ts — 5-minute first-migration onboarding wrapper.
 *
 * Goal: a new operator clones the repo, runs `npm install && npm run try-it`,
 * and sees a working Stage 1 plan against examples/sample-suite/bad-test.spec.ts
 * within ~90 seconds. Mirrors the same prompt + KB + rules that
 * .github/workflows/plan.yml uses in production — no shortcuts, no
 * synthetic output (except in --mock mode, which exists so CI can verify
 * wiring without spending Claude tokens).
 *
 * Stages:
 *   1. Detect auth env (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY).
 *      Print actionable setup instructions if both are missing.
 *   2. Ensure prompts/_assembled/analyze.md exists (assemble-prompts).
 *   3. Either:
 *      - --mock: copy examples/sample-suite/mock-plan.md → outputs/plans/bad-test.spec.ts.md
 *      - real:   invoke the claude CLI exactly the way plan.yml does, with the same
 *                model + max-turns + permission-mode + output-format flags.
 *   4. Print the plan path + a short narration of the structure.
 *
 * CLI:
 *   npx tsx scripts/try-it.ts            # real Claude call
 *   npx tsx scripts/try-it.ts --mock     # canned plan, no Claude call
 *   npx tsx scripts/try-it.ts --help
 */

import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const SAMPLE_INPUT = join(REPO_ROOT, "examples/sample-suite/bad-test.spec.ts");
const SAMPLE_MOCK_PLAN = join(REPO_ROOT, "examples/sample-suite/mock-plan.md");
const OUTPUT_PLAN = join(REPO_ROOT, "outputs/plans/bad-test.spec.ts.md");
const ASSEMBLED_PROMPT = join(REPO_ROOT, "prompts/_assembled/analyze.md");

interface ParsedArgs {
  mock: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { mock: false, help: false };
  for (const arg of argv) {
    if (arg === "--mock") out.mock = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    [
      "try-it — run Stage 1 (plan) against the demo sample suite.",
      "",
      "Usage:",
      "  npm run try-it             real Claude call (needs auth env)",
      "  npm run try-it -- --mock   canned plan, no Claude call (~1s)",
      "  npm run try-it -- --help   this message",
      "",
      "Required env (one of):",
      "  CLAUDE_CODE_OAUTH_TOKEN    Generate via `claude setup-token` (Claude Pro/Max)",
      "  ANTHROPIC_API_KEY          From https://console.anthropic.com/",
      "",
      "Output:",
      "  outputs/plans/bad-test.spec.ts.md",
      "",
    ].join("\n"),
  );
}

function detectAuth(): { kind: "oauth" | "api" | "none"; value: string } {
  const oauth = (process.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  const api = (process.env["ANTHROPIC_API_KEY"] ?? "").trim();
  if (oauth.length > 0) return { kind: "oauth", value: oauth };
  if (api.length > 0) return { kind: "api", value: api };
  return { kind: "none", value: "" };
}

function printMissingAuth(): void {
  process.stdout.write(
    [
      "",
      "  ERROR: no Claude auth detected.",
      "",
      "  Set ONE of these env vars and re-run:",
      "",
      "    Option A — OAuth (uses your Claude Pro/Max subscription, recommended):",
      "      1. Run `claude setup-token` in a terminal where you're logged in to Claude.",
      "      2. Export the resulting token:",
      "         export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...",
      "",
      "    Option B — Anthropic API key (separate billing):",
      "      1. Create a key at https://console.anthropic.com/",
      "      2. export ANTHROPIC_API_KEY=sk-ant-api...",
      "",
      "  Then re-run: npm run try-it",
      "",
      "  No subscription handy? Run the script with --mock to see the demo plan:",
      "      npm run try-it -- --mock",
      "",
    ].join("\n"),
  );
}

interface StepResult {
  label: string;
  ms: number;
}

function nowMs(): number {
  return Date.now();
}

function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function logStep(label: string): void {
  process.stdout.write(`  [step] ${label} ... `);
}

function logStepOk(ms: number): void {
  process.stdout.write(`ok (${fmtSec(ms)})\n`);
}

function ensureAssembledPrompt(steps: StepResult[]): void {
  logStep("assemble prompt fragments");
  const start = nowMs();
  if (!existsSync(ASSEMBLED_PROMPT)) {
    execSync("npx tsx scripts/assemble-prompts.ts --write", {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  }
  const ms = nowMs() - start;
  steps.push({ label: "assemble", ms });
  logStepOk(ms);
}

function ensureOutputDir(): void {
  mkdirSync(dirname(OUTPUT_PLAN), { recursive: true });
}

function runMock(steps: StepResult[]): void {
  logStep("copy canned plan (mock mode)");
  const start = nowMs();
  copyFileSync(SAMPLE_MOCK_PLAN, OUTPUT_PLAN);
  const ms = nowMs() - start;
  steps.push({ label: "mock-copy", ms });
  logStepOk(ms);
}

function runRealClaude(auth: { kind: "oauth" | "api"; value: string }, steps: StepResult[]): void {
  logStep("call Claude (Stage 1, model claude-sonnet-4-6)");
  const start = nowMs();
  const env = { ...process.env };
  if (auth.kind === "oauth") {
    env["CLAUDE_CODE_OAUTH_TOKEN"] = auth.value;
    delete env["ANTHROPIC_API_KEY"];
  } else {
    env["ANTHROPIC_API_KEY"] = auth.value;
    delete env["CLAUDE_CODE_OAUTH_TOKEN"];
  }

  // Mirror plan.yml's prompt verbatim where possible. Stage 1 reads:
  //   prompts/_assembled/analyze.md   (task spec)
  //   config/migration-rules.md       (target style + structure contract)
  //   config/knowledge-base.md        (anti-pattern catalog + KB-IDs)
  //   examples/reference/company-style.spec.ts (style anchor)
  //   the input file
  // Writes ONE markdown file at OUTPUT_PATH.
  const prompt = [
    "You are running Stage 1 of the PWmodernizer pipeline (local try-it onboarding run).",
    "",
    "## Your task",
    "",
    "Read prompts/_assembled/analyze.md — that's your full system prompt and task",
    "description. Follow it exactly.",
    "",
    "## Input for this run",
    "",
    `- Input path: ${SAMPLE_INPUT}`,
    `- Output plan path to write: ${OUTPUT_PLAN}`,
    "",
    "## Context to load (in this order)",
    "",
    "1. prompts/_assembled/analyze.md — your task spec (READ FIRST)",
    "2. config/migration-rules.md — target style + structure contract",
    "3. config/knowledge-base.md — anti-pattern catalog + API translations",
    "4. examples/reference/company-style.spec.ts — style anchor",
    `5. ${SAMPLE_INPUT} — the input to migrate`,
    "",
    "## Deliverable",
    "",
    `ONE markdown file at ${OUTPUT_PLAN}. NO code generation. Follow the`,
    "plan schema in config/migration-rules.md §9 — every section must be",
    "present. Mark each locator translation with HIGH / MED / LOW confidence",
    "per prompts/_assembled/analyze.md hallucination-defense rules.",
  ].join("\n");

  const result = spawnSync(
    "npx",
    [
      "--yes",
      "@anthropic-ai/claude-code",
      "--model",
      "claude-sonnet-4-6",
      "--max-turns",
      "12",
      "--print",
      "--permission-mode",
      "acceptEdits",
      prompt,
    ],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  const ms = nowMs() - start;
  steps.push({ label: "claude-call", ms });
  if (result.status !== 0) {
    process.stdout.write("FAILED\n");
    process.stderr.write(
      [
        "",
        `Claude CLI exited with code ${String(result.status)}.`,
        "",
        "Common causes:",
        "  - Auth token expired (re-run `claude setup-token`).",
        "  - Network failure (retry in a minute).",
        "  - claude-code CLI not on PATH (npx will fetch it — first run downloads ~30 MB).",
        "",
        "Fallback: re-run with --mock to see the canned plan and verify wiring:",
        "  npm run try-it -- --mock",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  logStepOk(ms);
}

function summarisePlan(steps: StepResult[]): void {
  if (!existsSync(OUTPUT_PLAN)) {
    process.stderr.write(`\n  ERROR: expected plan at ${OUTPUT_PLAN} but file is missing.\n`);
    process.exit(1);
  }
  const body = readFileSync(OUTPUT_PLAN, "utf8");
  const sections = [
    "## Source framework",
    "## Summary",
    "## Anti-patterns detected",
    "## Locator translation table",
    "## Structural changes",
    "## Open questions for reviewer",
    "## Risk callouts",
    "## Expected metrics",
  ];
  const present = sections.filter((s) => body.includes(s));

  const totalMs = steps.reduce((acc, s) => acc + s.ms, 0);

  process.stdout.write("\n");
  process.stdout.write(`  Plan written: ${OUTPUT_PLAN}\n`);
  process.stdout.write(`  Sections present: ${String(present.length)}/${String(sections.length)}\n`);
  process.stdout.write(`  Total runtime: ${fmtSec(totalMs)}\n`);
  process.stdout.write("\n");
  process.stdout.write("  What just happened\n");
  process.stdout.write("  ------------------\n");
  process.stdout.write("  Stage 1 read the demo spec, the knowledge base, and the pwm-blueprint\n");
  process.stdout.write("  style anchor; it produced a structured migration plan with:\n");
  process.stdout.write("    - a table of detected anti-patterns (severity + KB-ID)\n");
  process.stdout.write("    - a locator translation table with HIGH/MED/LOW confidence\n");
  process.stdout.write("    - open questions for the reviewer\n");
  process.stdout.write("    - risk callouts the reviewer must resolve before Stage 2\n");
  process.stdout.write("\n");
  process.stdout.write("  This is the same prompt + KB that plan.yml runs in CI.\n");
  process.stdout.write("\n");
  process.stdout.write("  next: read outputs/plans/bad-test.spec.ts.md\n");
  process.stdout.write("  then: docs/quickstart.md explains how to run your own migration\n");
  process.stdout.write("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  process.stdout.write("\nPWmodernizer try-it — 5-minute first migration\n\n");
  process.stdout.write(`  Input: ${SAMPLE_INPUT}\n`);
  process.stdout.write(`  Mode:  ${args.mock ? "mock (no Claude call)" : "real (Stage 1 call)"}\n\n`);

  if (!existsSync(SAMPLE_INPUT)) {
    process.stderr.write(`  ERROR: sample input missing at ${SAMPLE_INPUT}\n`);
    process.exit(1);
  }

  const steps: StepResult[] = [];
  ensureOutputDir();

  if (args.mock) {
    if (!existsSync(SAMPLE_MOCK_PLAN)) {
      process.stderr.write(`  ERROR: mock plan missing at ${SAMPLE_MOCK_PLAN}\n`);
      process.exit(1);
    }
    runMock(steps);
  } else {
    const auth = detectAuth();
    if (auth.kind === "none") {
      printMissingAuth();
      process.exit(1);
    }
    // TypeScript narrowing: auth.kind is now "oauth" | "api" after the guard above.
    const resolvedAuth: { kind: "oauth" | "api"; value: string } = {
      kind: auth.kind,
      value: auth.value,
    };
    ensureAssembledPrompt(steps);
    runRealClaude(resolvedAuth, steps);
  }

  summarisePlan(steps);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n  FATAL: ${msg}\n`);
  process.exit(1);
});
