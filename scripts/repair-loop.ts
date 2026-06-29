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
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { collectEmittedFiles } from "./evaluate.js";
import { findGeneratedSpec } from "./output-spec.js";
import { extractPwAssertions, compareStrength, type PwAssertion, type StrengthViolation } from "./lib/assertion-ast.js";

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

/**
 * Pull the page-snapshot YAML block out of a Playwright `error-context.md`. On a
 * failure Playwright writes the aria tree of the page AT THE MOMENT THE LOCATOR
 * FAILED — the exact page (already navigated + authenticated) the broken locator
 * ran against. That is a strictly better repair signal than re-snapshotting the
 * base URL, which only ever shows the login/landing page (IMP8). Returns the
 * fenced ```yaml block's body, or "" if the file carries no snapshot.
 */
export function extractPageSnapshot(md: string): string {
  const m = /```ya?ml\s*\n([\s\S]*?)```/.exec(md);
  return m ? (m[1] ?? "").trim() : "";
}

/**
 * Find the newest `error-context.md` Playwright wrote for THIS spec and return
 * its failure-time page snapshot. Playwright names each result dir
 * `<specStem>-<title>-<project>`, so we match dirs by the spec's kebab stem and
 * pick the most recently modified. Returns "" when none exists (caller falls
 * back to a fresh base-URL snapshot).
 */
export function findFailureSnapshot(specStem: string, root = join(REPO_ROOT, "test-results")): string {
  if (!existsSync(root)) return "";
  let newest: { path: string; mtime: number } | null = null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!(entry.name === specStem || entry.name.startsWith(`${specStem}-`))) continue;
    const ctx = join(root, entry.name, "error-context.md");
    if (!existsSync(ctx)) continue;
    const mtime = statSync(ctx).mtimeMs;
    if (!newest || mtime > newest.mtime) newest = { path: ctx, mtime };
  }
  if (!newest) return "";
  return extractPageSnapshot(readFileSync(newest.path, "utf8"));
}

/** Pick the repair grounding: Playwright's failure-time page snapshot if present
 * (the exact page the broken locator ran against), else a fresh base-URL snap. */
function selectRepairSnapshot(spec: string, url: string): { snapshot: string; atFailure: boolean } {
  const failSnap = findFailureSnapshot(basename(spec).replace(/\.spec\.ts$/, ""));
  if (failSnap.length > 0) {
    process.stdout.write("    grounding repair with the FAILURE-TIME page snapshot (error-context.md)\n");
    return { snapshot: failSnap, atFailure: true };
  }
  process.stdout.write("    grounding repair with a fresh base-URL snapshot\n");
  return { snapshot: freshSnapshot(url), atFailure: false };
}

/**
 * Detect the "auth is not self-contained" failure class: the migrated tree
 * references a `storageState` file (the idiomatic Playwright pre-baked-auth
 * pattern) that NOTHING in the pipeline produces, so every test dies at setup
 * with ENOENT before a page ever loads. The repair model can't fix this by
 * tweaking locators — it has to make authentication self-contained (IMP9).
 */
export function isAuthBootstrapFailure(failureTail: string): boolean {
  return /storage ?state|reading storage state|\.auth[/\\]|ENOENT[^\n]*auth/i.test(failureTail);
}

/** Build the repair prompt — the execution error is the load-bearing signal.
 * When `atFailure` is true, `snapshot` is Playwright's aria tree captured at the
 * exact moment the locator failed (the right page, already authenticated) — far
 * more authoritative than a fresh base-URL snapshot, so we say so and show more.
 * `source` (the original legacy test) is the INTENT reference: the behaviours +
 * the real login steps the migration must preserve (IMP9). */
export function buildRepairPrompt(
  spec: string, files: string[], failureTail: string, snapshot: string, url: string,
  atFailure = false, source = "",
): string {
  const fileList = files.map((f) => `- ${relative(REPO_ROOT, f)}`).join("\n");
  const snapHeader = atFailure
    ? "## The page's accessibility tree AT THE MOMENT OF FAILURE (the exact page the broken locator ran against — authoritative)"
    : "## The live page's accessibility tree RIGHT NOW (the closed vocabulary — only these exist)";
  const tail = failureTail.trim().split("\n").slice(-40).join("\n");
  const lines = [
    "You are repairing a migrated Playwright test that COMPILES and passes every static gate",
    `but FAILS when run against the real app (${url}). The execution error is the ground truth.`,
    "",
    "## The failure (from `playwright test` against the live app)",
    "```",
    tail,
    "```",
    "",
    snapHeader,
    "```yaml",
    snapshot.trim().split("\n").slice(0, atFailure ? 90 : 60).join("\n"),
    "```",
    "",
  ];
  if (source.trim().length > 0) {
    lines.push(
      "## The SOURCE test (the INTENT reference — preserve these behaviours AND its login steps)",
      "```",
      source.trim().slice(0, 3000),
      "```",
      "",
    );
  }
  // Auth-bootstrap failure: the test depends on a storageState file the pipeline
  // never creates. Tweaking locators cannot fix it — make auth self-contained.
  if (isAuthBootstrapFailure(tail)) {
    lines.push(
      "## CRITICAL — authentication is NOT self-contained (fix THIS first)",
      "The test depends on a `storageState` auth file that this pipeline never creates, so it dies at",
      "setup before any page loads. You MUST make authentication self-contained. Prefer the option that",
      "matches the SOURCE: the source logs in inline (in a `beforeEach`), so:",
      "- PREFERRED: remove the `storageState` fixture dependency and perform the login INLINE in a",
      "  `test.beforeEach` (navigate to the login page, fill credentials, submit) using a LoginPage page",
      "  object and the SOURCE's exact selectors/steps. The test must log itself in with no external file.",
      "- Credentials: read from env (e.g. `process.env.SAUCE_USERNAME`) with the standard SauceDemo",
      "  fallback (`standard_user` / `secret_sauce`) so the test runs unattended.",
      "- Do NOT invent a storageState file path and do NOT leave a dangling auth fixture.",
      "",
    );
  }
  lines.push(
    "## Files you may edit (the spec + the page objects it reaches — edit ONLY these)",
    fileList,
    "",
    "## Your task",
    `- Fix the test so it PASSES against ${url}.`,
    "- The accessible NAME in the snapshot is authoritative, but the snapshot does NOT tell you how the",
    "  name is derived. If `getByLabel(name)` fails, the field likely has a placeholder or aria-label, not a",
    "  <label>: prefer `getByRole('textbox', { name })` or `getByPlaceholder(name)` — pick the one that",
    "  actually resolves on this page.",
    "- Keep qa-master architecture (locators in the page object, web-first assertions, no hard waits).",
    "- Do NOT weaken assertions to make them pass; fix the locator/target so the real assertion holds.",
    "- Edit the existing files in place (you MAY add a LoginPage page object if auth needs it).",
  );
  return lines.join("\n");
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

/** Run eslint (incl. eslint-plugin-playwright) on the emitted .ts files; the same
 * gate CI's lint-output workflow runs. Returns clean + the eslint output. */
function runLintGate(files: string[]): { clean: boolean; output: string } {
  const tsFiles = files.filter((f) => f.endsWith(".ts"));
  if (tsFiles.length === 0) return { clean: true, output: "" };
  const r = spawnSync("npx", ["eslint", ...tsFiles], { cwd: REPO_ROOT, encoding: "utf8" });
  return { clean: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Lint-repair prompt: the test is ALREADY green on the live app — fix only the
 * lint errors without touching behaviour (IMP5). */
export function buildLintRepairPrompt(files: string[], lintOutput: string): string {
  const fileList = files.map((f) => `- ${relative(REPO_ROOT, f)}`).join("\n");
  return [
    "A migrated Playwright test RUNS GREEN against the live app, but it FAILS the lint gate",
    "(eslint + eslint-plugin-playwright). Fix ONLY the lint errors, without changing behaviour.",
    "",
    "## eslint output",
    "```",
    lintOutput.trim().split("\n").slice(-40).join("\n"),
    "```",
    "",
    "## Files you may edit",
    fileList,
    "",
    "## Rules",
    "- Fix the reported errors at the cause (e.g. remove an unused `expect` import / dead var).",
    "- Do NOT change assertions, locators, or behaviour — the test is green; keep it green.",
    "- Do NOT add eslint-disable comments to silence a rule.",
    "- Keep qa-master architecture (spec imports from @fixtures/base.fixture; locators in POMs).",
  ].join("\n");
}

/** After execution-green, best-effort lint-repair so the accepted output is ALSO
 * lint-clean (CI's lint-output gate). Execution stays the primary signal — this
 * cleans the green, never fails it. Re-verifies execution after any edit (IMP5). */
function ensureLintClean(base: string, url: string, mock: boolean): void {
  const spec = findGeneratedSpec(OUT_DIR, base);
  if (!spec) return;
  const files = collectEmittedFiles(spec).filter(existsSync);
  let lint = runLintGate(files);
  if (lint.clean) { process.stdout.write("    lint: clean ✓\n"); return; }
  if (mock) { process.stdout.write("    [mock] green but lint-dirty — would lint-repair.\n"); return; }
  const auth = detectAuth();
  if (auth.kind === "none") return;
  let edited = false;
  for (let i = 1; i <= 2 && !lint.clean; i++) {
    process.stdout.write(`    lint-repair ${i}/2 — green but not lint-clean; fixing lint errors\n`);
    if (!runClaude(auth, buildLintRepairPrompt(files, lint.output))) break;
    edited = true;
    lint = runLintGate(files);
  }
  if (edited && !runExecutionGate(base, url).green) {
    process.stdout.write("    ⚠ lint-repair edits regressed execution — review (the pre-lint output was green).\n");
    return;
  }
  process.stdout.write(lint.clean ? "    lint: clean after repair ✓\n" : "    lint: still flagged after repair — accepted on execution-green; flag for human.\n");
}

/** One repair attempt after a failed run: build the prompt + (mock or) call
 * Claude to edit in place. Returns null to continue the loop, or an exit code. */
function handleFailure(base: string, url: string, source: string, mock: boolean, failureTail: string): number | null {
  const spec = findGeneratedSpec(OUT_DIR, base);
  if (!spec) { process.stderr.write(`  no spec for ${base}\n`); return 1; }
  const files = collectEmittedFiles(spec).filter(existsSync);
  // Prefer Playwright's failure-time page snapshot (the exact page the broken
  // locator ran against) over a blind base-URL re-snapshot (IMP8).
  const { snapshot, atFailure } = selectRepairSnapshot(spec, url);
  const prompt = buildRepairPrompt(spec, files, failureTail, snapshot, url, atFailure, source);

  if (mock) {
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
  return null;
}

/** The assertions across the migrated tree right now (spec + reachable POMs). */
function snapshotAssertions(base: string): PwAssertion[] {
  const spec = findGeneratedSpec(OUT_DIR, base);
  if (!spec) return [];
  return collectEmittedFiles(spec).filter(existsSync).flatMap((f) => extractPwAssertions(readFileSync(f, "utf8")));
}

/** Tell Claude to undo an assertion-weakening it made to go green (B1). */
export function buildAssertionRestorePrompt(files: string[], violations: StrengthViolation[]): string {
  const fileList = files.map((f) => `- ${relative(REPO_ROOT, f)}`).join("\n");
  return [
    "A repair made the test pass by WEAKENING its assertions — that is forbidden. The test must verify",
    "the SAME behaviour it verified before. Restore assertion strength and fix the LOCATOR/target instead.",
    "",
    "## Weakenings detected (each must be undone)",
    ...violations.map((v) => `- ${v.kind}: ${v.detail}`),
    "",
    "## Rules",
    "- Restore each assertion to AT LEAST its original matcher strength (e.g. toBeVisible() back to toHaveText('3')).",
    "- Restore any dropped `.not.` or removed assertion.",
    "- If a strong assertion fails, the real bug is the LOCATOR or the app state you reach — fix THAT, never the assertion.",
    "- Never substitute a weaker matcher, a permissive regex, or delete an assert to go green.",
    "",
    "## Files you may edit",
    fileList,
  ].join("\n");
}

/**
 * Accept a green run ONLY if the repair did not WEAKEN assertions versus the
 * freshly-generated original (B1). If it did, attempt ONE restore edit + re-verify;
 * accept only an HONEST green (strong assertions AND passing), else reject — a
 * green bought by weakening an assertion is a false green, worse than a red.
 * Returns the process exit code.
 */
function finalizeGreen(base: string, url: string, original: PwAssertion[], mock: boolean): number {
  let violations = compareStrength(original, snapshotAssertions(base));
  if (violations.length === 0) { ensureLintClean(base, url, mock); return 0; }
  process.stdout.write(`  ⚠ green reached by WEAKENING assertions: ${violations.map((v) => v.detail).join("; ")}\n`);
  if (mock) return 1;
  const auth = detectAuth();
  if (auth.kind === "none") return 1;
  const spec = findGeneratedSpec(OUT_DIR, base);
  const files = spec ? collectEmittedFiles(spec).filter(existsSync) : [];
  process.stdout.write("  ⚠ restoring assertion strength + re-running ...\n");
  if (!runClaude(auth, buildAssertionRestorePrompt(files, violations))) return 1;
  const reGate = runExecutionGate(base, url);
  violations = compareStrength(original, snapshotAssertions(base));
  if (reGate.green && violations.length === 0) { ensureLintClean(base, url, mock); return 0; }
  process.stdout.write(`  ✗ rejecting — ${reGate.green ? "assertions still weakened" : "the real assertion fails (was passing only by weakening)"}; needs human review.\n`);
  return 1;
}

function main(): number {
  const { values } = parseArgs({
    options: {
      "input-basename": { type: "string" },
      url: { type: "string" },
      source: { type: "string" },
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
  // The original legacy test — the intent reference (behaviours + login steps).
  const source = values.source && existsSync(values.source) ? readFileSync(values.source, "utf8") : "";
  const maxIter = Math.max(1, Number(values["max-iterations"] ?? "3"));
  // Baseline assertions from the freshly-generated tree — repair must not weaken
  // them to reach green (B1).
  const assertsOriginal = snapshotAssertions(base);

  for (let iter = 1; iter <= maxIter; iter++) {
    process.stdout.write(`\n  repair-loop iteration ${iter}/${maxIter} — running ${base} against ${url}\n`);
    const gate = runExecutionGate(base, url);
    if (gate.green) {
      process.stdout.write(`  ✅ GREEN — ${base} passes against ${url}${iter > 1 ? ` (repaired in ${iter - 1} iteration(s))` : " (no repair needed)"}.\n`);
      return finalizeGreen(base, url, assertsOriginal, values.mock === true); // IMP5 lint + B1 assertion-strength
    }
    process.stdout.write(`  ✗ failed against the live app — capturing snapshot + reaching files for repair\n`);
    const code = handleFailure(base, url, source, values.mock === true, gate.failureTail);
    if (code !== null) return code;
  }
  // The loop runs the gate at the START of each iteration, so the LAST iteration's
  // repair edit is never verified (it would only be checked by a run that never
  // happens). Without this final check the loop reports "still failing" even when
  // that last edit actually fixed it — a false negative the independent gate then
  // contradicts (IMP12). Verify the final repair before giving up.
  const final = runExecutionGate(base, url);
  if (final.green) {
    process.stdout.write(`  ✅ GREEN — ${base} passes against ${url} (repaired on the final iteration, ${maxIter}/${maxIter}).\n`);
    return finalizeGreen(base, url, assertsOriginal, values.mock === true); // IMP5 lint + B1 assertion-strength
  }
  process.stdout.write(`\n  ✗ still failing after ${maxIter} repair iteration(s) — needs human review.\n`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
