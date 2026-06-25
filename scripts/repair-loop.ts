#!/usr/bin/env tsx
/**
 * repair-loop.ts — execution-guided repair (the closure of the closed loop, BP3).
 *
 * Prior art (Self-Debug, Reflexion, SWE-agent, Aider): generate → RUN → on
 * failure feed the execution error back to the model → regenerate → re-run, a
 * few times, until green. This closes our pipeline: the static gates prove a
 * migration COMPILES; only running it against the real app proves it WORKS, and
 * the error from that run is the richest possible repair signal.
 *
 * Each iteration:
 *   1. run the migrated spec against the live SUT (run-against-sut);
 *   2. green → accept, done;
 *   3. failed → capture the failure tail + a FRESH aria snapshot of the SUT +
 *      the spec and the POMs it reaches, and ask Claude to fix the locators/
 *      assertions (edit existing files only); then re-run.
 * Cap at --max-iterations (default 3). Persisted failure feeds the next prompt.
 *
 *   npx tsx scripts/repair-loop.ts --input-basename saucedemo-login.cy.js --url https://www.saucedemo.com
 *   ... --mock   # show the repair prompt + plan, no Claude call
 *
 * Exit: 0 = repaired to green (or already green); 1 = still failing after N iters
 *       or setup error.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { collectEmittedFiles } from "./evaluate.js";
import { findGeneratedSpec } from "./output-spec.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT_DIR = join(REPO_ROOT, "outputs/tests");

interface Auth { kind: "oauth" | "api" | "none"; value: string }
function detectAuth(): Auth {
  const oauth = (process.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  const api = (process.env["ANTHROPIC_API_KEY"] ?? "").trim();
  if (oauth.length > 0) return { kind: "oauth", value: oauth };
  if (api.length > 0) return { kind: "api", value: api };
  return { kind: "none", value: "" };
}

/** Run the execution gate; return whether it's green + the failure tail. */
function runExecutionGate(base: string, url: string): { green: boolean; failureTail: string } {
  const r = spawnSync("npx", ["tsx", "scripts/run-against-sut.ts", "--input-basename", base, "--url", url], {
    cwd: REPO_ROOT, encoding: "utf8",
  });
  const failPath = join(REPO_ROOT, "outputs/reports", `${base.replace(/[^\w.-]/g, "_")}-sut-failure.txt`);
  const failureTail = r.status !== 0 && existsSync(failPath) ? readFileSync(failPath, "utf8") : `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").slice(-30).join("\n");
  return { green: r.status === 0, failureTail };
}

/** Capture a fresh aria snapshot of the SUT to a temp file; return its content. */
function freshSnapshot(url: string): string {
  const out = join(REPO_ROOT, "outputs/dom-snapshots", "_repair-fresh.yaml");
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync("npx", ["tsx", "scripts/dom-snapshot.ts", "--url", url, "--output", out], { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 && existsSync(out) ? readFileSync(out, "utf8") : "(snapshot capture failed)";
}

/** Build the repair prompt — the execution error is the load-bearing signal. */
export function buildRepairPrompt(spec: string, files: string[], failureTail: string, snapshot: string, url: string): string {
  const fileList = files.map((f) => `- ${relative(REPO_ROOT, f)}`).join("\n");
  return [
    "You are repairing a migrated Playwright test that COMPILES and passes every static gate",
    `but FAILS when run against the real app (${url}). The execution error is the ground truth.`,
    "",
    "## The failure (from `playwright test` against the live app)",
    "```",
    failureTail.trim().split("\n").slice(-40).join("\n"),
    "```",
    "",
    "## The live page's accessibility tree RIGHT NOW (the closed vocabulary — only these exist)",
    "```yaml",
    snapshot.trim().split("\n").slice(0, 60).join("\n"),
    "```",
    "",
    "## Files you may edit (the spec + the page objects it reaches — edit ONLY these)",
    fileList,
    "",
    "## Your task",
    `- Fix the locators/assertions so the test PASSES against ${url}.`,
    "- The accessible NAME in the snapshot is authoritative, but the snapshot does NOT tell you how the",
    "  name is derived. If `getByLabel(name)` fails, the field likely has a placeholder or aria-label, not a",
    "  <label>: prefer `getByRole('textbox', { name })` or `getByPlaceholder(name)` — pick the one that",
    "  actually resolves on this page.",
    "- Keep qa-master architecture (locators in the page object, web-first assertions, no hard waits).",
    "- Do NOT weaken assertions to make them pass; fix the locator/target so the real assertion holds.",
    "- Edit the existing files in place. Do not create new files.",
  ].join("\n");
}

function runClaude(auth: Auth, prompt: string): boolean {
  const env = { ...process.env };
  if (auth.kind === "oauth") { env["CLAUDE_CODE_OAUTH_TOKEN"] = auth.value; delete env["ANTHROPIC_API_KEY"]; }
  else { env["ANTHROPIC_API_KEY"] = auth.value; delete env["CLAUDE_CODE_OAUTH_TOKEN"]; }
  const r = spawnSync("npx", [
    "--yes", "@anthropic-ai/claude-code",
    "--model", "claude-sonnet-4-6", "--max-turns", "30", "--print", "--permission-mode", "acceptEdits", prompt,
  ], { cwd: REPO_ROOT, env, stdio: ["ignore", "inherit", "inherit"] });
  return r.status === 0;
}

function main(): number {
  const { values } = parseArgs({
    options: {
      "input-basename": { type: "string" },
      url: { type: "string" },
      "max-iterations": { type: "string", default: "3" },
      mock: { type: "boolean", default: false },
    },
    strict: true,
  });
  const base = values["input-basename"];
  const url = values.url ?? process.env["MIGRATION_TARGET_URL"] ?? "";
  if (!base || !url) {
    process.stderr.write("repair-loop: --input-basename <base> and --url <sut> are required.\n");
    return 1;
  }
  const maxIter = Math.max(1, Number(values["max-iterations"] ?? "3"));

  for (let iter = 1; iter <= maxIter; iter++) {
    process.stdout.write(`\n  repair-loop iteration ${iter}/${maxIter} — running ${base} against ${url}\n`);
    const gate = runExecutionGate(base, url);
    if (gate.green) {
      process.stdout.write(`  ✅ GREEN — ${base} passes against ${url}${iter > 1 ? ` (repaired in ${iter - 1} iteration(s))` : " (no repair needed)"}.\n`);
      return 0;
    }
    process.stdout.write(`  ✗ failed against the live app — capturing snapshot + reaching files for repair\n`);
    const spec = findGeneratedSpec(OUT_DIR, base);
    if (!spec) { process.stderr.write(`  no spec for ${base}\n`); return 1; }
    const files = collectEmittedFiles(spec).filter(existsSync);
    const prompt = buildRepairPrompt(spec, files, gate.failureTail, freshSnapshot(url), url);

    if (values.mock) {
      const mockOut = join(REPO_ROOT, "outputs/reports", "_repair-prompt.txt");
      mkdirSync(dirname(mockOut), { recursive: true });
      writeFileSync(mockOut, prompt);
      process.stdout.write(`  [mock] repair prompt written to ${relative(REPO_ROOT, mockOut)} (${files.length} files in scope); no Claude call.\n`);
      return 1;
    }
    const auth = detectAuth();
    if (auth.kind === "none") { process.stderr.write("  no Claude auth (set CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY).\n"); return 1; }
    process.stdout.write(`  ⚠ calling Claude to repair (${files.length} files in scope) ...\n`);
    if (!runClaude(auth, prompt)) { process.stderr.write("  Claude repair call failed.\n"); return 1; }
  }
  process.stdout.write(`\n  ✗ still failing after ${maxIter} repair iteration(s) — needs human review.\n`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
