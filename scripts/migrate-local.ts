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
 *   npm run migrate -- --input <path> --mock   # wiring check + cost preview, no Claude call
 *   npm run migrate -- --inputs 'inputs/bad-playwright/*.spec.ts'  # batch; --mock = free preview
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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { computeCostUsd } from "./metrics.js";
import { listOutputSpecs, findGeneratedSpec } from "./output-spec.js";
import { deriveNavUrls, buildSnapshotFlow } from "./lib/nav-urls.js";
import { appKey, loadCache, renderCacheHints, recordFromReport } from "./locator-cache.js";
import { runClaudeCli } from "./lib/claude-cli.js";
import { UNVERIFIED_LOCATOR_CONFIDENCE_CAP } from "./evaluate.js";
import { transformCypress, codemodStats } from "./cypress-codemod.js";

// Re-exported from the shared resolver so existing importers of this symbol
// (validate-report-metrics, plan-code-coverage, conformance, tests) keep working.
export { expectedSpecBasenames } from "./output-spec.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const ASSEMBLED_GENERATE = join(REPO_ROOT, "prompts/_assembled/generate.md");
const INVENTORY_PATH = join(REPO_ROOT, "outputs/.snippets-inventory.md");
const OUT_DIR = join(REPO_ROOT, "outputs/tests");

export interface Args { input: string; inputs: string; plan: string; mock: boolean; help: boolean; check: boolean; profile: "pwm-blueprint" | "lean"; repair: boolean; isolate: boolean }
interface Paths { input: string; base: string; plan: string; envelope: string; report: string }
interface Auth { kind: "oauth" | "api" | "none"; value: string }
interface WallStep { name: string; cmd: string; args: string[] }
interface WallResult { name: string; ok: boolean; detail: string }

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      inputs: { type: "string" },
      plan: { type: "string" },
      mock: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      check: { type: "boolean", default: false },
      profile: { type: "string", default: "pwm-blueprint" },
      repair: { type: "boolean", default: false },
      isolate: { type: "boolean", default: false },
    },
  });
  return {
    input: values.input ?? "",
    inputs: values.inputs ?? "",
    plan: values.plan ?? "",
    mock: values.mock === true,
    help: values.help === true,
    check: values.check === true,
    profile: values.profile === "lean" ? "lean" : "pwm-blueprint",
    repair: values.repair === true,
    isolate: values.isolate === true,
  };
}

function printHelp(): void {
  process.stdout.write([
    "migrate — run Stage 2 (generate clean Playwright) on your own test, locally.",
    "",
    "Usage:",
    "  npm run migrate -- --input <path>            generate (needs auth + an approved plan)",
    "  npm run migrate -- --input <path> --plan <p> explicit plan path",
    "  npm run migrate -- --input <path> --mock     wiring check + cost preview, no Claude call",
    "  npm run migrate -- --inputs '<glob>'         batch over many inputs (sequential)",
    "  npm run migrate -- --inputs '<glob>' --mock  free batch wiring + cost preview",
    "  npm run migrate -- --inputs '<glob>' --isolate  per-input snapshot/restore: each",
    "                                               migration starts from the committed",
    "                                               baseline (no cross-migration POM bleed)",
    "                                               + its output is archived to",
    "                                               outputs/.batch/<input>/ for review.",
    "  npm run migrate -- --check                   preflight: Node/auth/plan setup doctor",
    "  npm run migrate -- --input <p> --profile lean  emit specs + page objects only (ADR 0002; default pwm-blueprint)",
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
export function derivePaths(args: Args): Paths {
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

/** Preflight doctor — checks a newcomer's environment before any migration. Returns 0 iff the critical checks (Node, auth) pass. */
function preflight(args: Args): number {
  process.stdout.write("\n  migrate --check (preflight)\n\n");
  const line = (ok: boolean, label: string, hint: string): boolean => {
    const suffix = ok ? "" : ` — ${hint}`;
    process.stdout.write(`    ${ok ? "✓" : "✗"} ${label}${suffix}\n`);
    return ok;
  };
  const nodeMajor = Number((process.versions.node ?? "0").split(".")[0]);
  const nodeOk = line(nodeMajor >= 22, `Node ${process.versions.node} (need 22+)`, "install Node 22+ (nvm install 22)");
  const auth = detectAuth();
  const authOk = line(auth.kind !== "none", `Claude auth (${auth.kind})`, "set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) or ANTHROPIC_API_KEY");
  // gh is optional (only for the plan-PR flow), so it never fails the preflight.
  line(spawnSync("gh", ["--version"], { encoding: "utf8" }).status === 0, "gh CLI (optional — for plan PRs)", "brew install gh / apt install gh");
  if (args.input) {
    const p = derivePaths(args);
    line(existsSync(p.input), `input ${args.input}`, "path not found");
    line(existsSync(p.plan), `plan ${p.plan.replace(REPO_ROOT + "/", "")}`, "run Stage 1 first (plan.yml or npm run try-it)");
  }
  const ready = nodeOk && authOk;
  process.stdout.write(ready
    ? "\n  Ready. Run: npm run migrate -- --input <your-test> (add --mock for a free wiring check).\n\n"
    : "\n  Not ready — fix the ✗ items above.\n\n");
  return ready ? 0 : 1;
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

/** Capture the target page's accessibility tree (DOM grounding) when
 * MIGRATION_TARGET_URL is set. Runs the existing scripts/dom-snapshot.ts (a
 * Playwright launch — ZERO model tokens) and returns the snapshot path, or null
 * when no URL is set (offline migration, unchanged behaviour). */
function captureDomSnapshot(p: Paths): string | null {
  const out = join(REPO_ROOT, "outputs/dom-snapshots", `${p.base}.yaml`);
  // Reuse a pre-captured snapshot (e.g. a multi-page `--flow` capture for an
  // authenticated journey) instead of clobbering it with a single-page grab.
  if (existsSync(out)) {
    process.stdout.write(`  [step] DOM grounding — using existing snapshot ${relative(REPO_ROOT, out)}\n`);
    return out;
  }
  const url = (process.env["MIGRATION_TARGET_URL"] ?? "").trim();
  if (url.length === 0) return null;
  mkdirSync(dirname(out), { recursive: true });
  // Snapshot the ACTUAL page(s) the test navigates to (IMP1): derive the
  // nav URLs from the source so grounding sees the real form, not just the site
  // root. Falls back to the bare base URL when no URL is derivable.
  const navUrls = existsSync(p.input) ? deriveNavUrls(readFileSync(p.input, "utf8"), url) : [];
  const flow = buildSnapshotFlow(navUrls);
  const args = flow.length > 0
    ? ["tsx", "scripts/dom-snapshot.ts", "--flow", flow, "--output", out]
    : ["tsx", "scripts/dom-snapshot.ts", "--url", url, "--output", out];
  const targetDesc = flow.length > 0 ? `${navUrls.length} navigated page(s)` : url;
  process.stdout.write(`  [step] DOM grounding — capture a11y tree of ${targetDesc} ... `);
  const r = spawnSync("npx", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (r.status !== 0 || !existsSync(out)) {
    process.stdout.write("FAILED (continuing ungrounded)\n");
    process.stderr.write(`  dom-snapshot failed:\n${r.stderr ?? r.stdout ?? ""}\n`);
    return null;
  }
  process.stdout.write("ok\n");
  return out;
}

/** Reset outputs/helper + outputs/tests to the committed baseline (the pwm-blueprint
 * scaffolding: basepage/baseblock/base.fixture/logger), removing every generated
 * POM/block/spec/test-data. Git is the source of truth for the baseline. Used by
 * --isolate so a migration cannot inherit a sibling migration's locators. */
function resetSharedTree(): void {
  process.stdout.write("  [step] --isolate: resetting outputs/helper + outputs/tests to the committed baseline ... ");
  // Restore tracked baseline files (base.fixture gets extended per migration), then
  // remove untracked generated files. -q keeps it quiet; scoped to the two dirs.
  spawnSync("git", ["checkout", "HEAD", "--", "outputs/helper", "outputs/tests"], { cwd: REPO_ROOT });
  spawnSync("git", ["clean", "-fdq", "outputs/helper", "outputs/tests"], { cwd: REPO_ROOT });
  process.stdout.write("ok\n");
}

/**
 * Parse `git status --porcelain -uall` into the list of changed/untracked file
 * paths. Each line is `XY <path>` (2 status chars + space); a rename is
 * `R  old -> new` (keep the new path). Pure + exported for tests.
 */
export function parseDirtyPaths(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 3)
    .map((l) => l.slice(3).trim())
    .map((l) => (l.includes(" -> ") ? l.split(" -> ")[1] ?? l : l))
    .filter((p) => p.length > 0);
}

/**
 * B3 snapshot-and-restore: after an --isolate migration generates, copy THIS
 * migration's delta — every changed/untracked file under outputs/tests +
 * outputs/helper vs the committed baseline — into outputs/.batch/<base>/,
 * preserving the relative tree. A batch then PRESERVES every migration's output
 * (each authored by exactly one migration), instead of the next reset wiping
 * all but the last (the old wipe-forward). Returns the archive dir + file count.
 */
export function archiveIsolatedOutput(base: string): { dir: string; files: number } {
  const status = spawnSync(
    "git",
    ["status", "--porcelain", "-uall", "--", "outputs/tests", "outputs/helper"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  const dir = join(REPO_ROOT, "outputs/.batch", base);
  let files = 0;
  for (const rel of parseDirtyPaths(status.stdout ?? "")) {
    const src = join(REPO_ROOT, rel);
    if (!existsSync(src) || !statSync(src).isFile()) continue;
    const dest = join(dir, rel); // keeps outputs/tests/… and outputs/helper/… structure
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    files += 1;
  }
  return { dir, files };
}

/**
 * Offline abstention gate (lever 1) — runs ONLY when there is no DOM snapshot.
 * Without a SUT we can't ground, but we can still refuse a plan that pins a
 * HIGH-confidence locator whose accessible name isn't derivable from the source:
 * that is a confident hallucination. Runs PRE-generation so a hallucinated plan
 * is rejected before any Stage-2 tokens are spent. Deterministic, zero tokens.
 * Returns true when the plan is clean (or the gate can't apply).
 */
function offlineAbstentionGate(p: Paths): boolean {
  process.stdout.write("  [gate] plan DOM grounding (offline abstention) ... ");
  const r = spawnSync(
    "npx",
    ["tsx", "scripts/validate-plan-dom-grounding.ts", "--plan", p.plan, "--source", p.input],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (r.status === 0) {
    process.stdout.write("ok\n");
    return true;
  }
  process.stdout.write("FAILED\n");
  process.stderr.write(`${r.stderr ?? r.stdout ?? ""}\n`);
  process.stderr.write(
    "  A high-confidence pin names a locator not derivable from your source, and there is no\n" +
      "  DOM snapshot to ground it. Set MIGRATION_TARGET_URL to capture a snapshot, OR fix the\n" +
      "  plan: lower the pin's confidence + add a hallucination-defense pin, or use a CSS fallback.\n",
  );
  return false;
}

/** Derive the plan envelope (Stage 1 -> Stage 2 contract), only when absent — mirrors migrate.yml's `if [ ! -f "$ENV" ]` safety net so a committed Stage-1 envelope is trusted, not clobbered. Returns false on failure (the batch loop continues to the next input; the single-input path turns it into a non-zero exit). */
function deriveEnvelope(p: Paths): boolean {
  process.stdout.write("  [step] derive plan envelope ... ");
  if (existsSync(p.envelope)) {
    process.stdout.write("ok (present — trusting committed Stage-1 envelope)\n");
    return true;
  }
  const r = spawnSync("npx", [
    "tsx", "scripts/derive-envelope.ts", "--plan", p.plan, "--out", p.envelope,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    process.stdout.write("FAIL\n");
    process.stderr.write(`  derive-envelope failed:\n${r.stderr ?? r.stdout ?? ""}\n`);
    return false;
  }
  process.stdout.write("ok\n");
  return true;
}

/** Schema-validate the envelope before spending tokens — mirrors migrate.yml's fail-fast FIRST gate. Returns false on failure. */
function validateEnvelopeSchema(p: Paths): boolean {
  process.stdout.write("  [step] validate envelope schema ... ");
  const r = spawnSync("npx", [
    "tsx", "scripts/plan-envelope-validate.ts", "--envelope", p.envelope,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    process.stdout.write("FAIL\n");
    process.stderr.write(`  envelope schema invalid:\n${r.stderr ?? r.stdout ?? ""}\n`);
    return false;
  }
  process.stdout.write("ok\n");
  return true;
}

/** The assembled system prompt for the active profile — lean reads
 * generate.lean.md (spec + page object only); pwm-blueprint reads generate.md. */
export function assembledPromptPath(profile: Args["profile"]): string {
  if (profile === "lean") {
    const lean = join(REPO_ROOT, "prompts/_assembled/generate.lean.md");
    if (existsSync(lean)) return lean;
  }
  return ASSEMBLED_GENERATE;
}

/** Build the CLOSED-VOCABULARY DOM-grounding block from a captured a11y snapshot.
 * This is the fix for hallucinated locators: Stage 2 may only emit accessible
 * names that EXIST in this snapshot — exactly the Playwright-MCP / Stagehand
 * pattern (the model picks from a real, closed set instead of guessing). */
function domGroundingBlock(snapshotPath: string | null): string {
  if (snapshotPath === null || !existsSync(snapshotPath)) return "";
  let snapshot = "";
  try {
    snapshot = readFileSync(snapshotPath, "utf8");
  } catch {
    return "";
  }
  if (snapshot.trim().length === 0) return "";
  return [
    "",
    "## DOM grounding — CLOSED VOCABULARY (MANDATORY, overrides any guess)",
    "The REAL accessibility tree of the target page is below. It is the ONLY source",
    "of truth for accessible names. RULES:",
    "- Every getByRole / getByLabel / getByText / getByPlaceholder you emit MUST cite",
    "  a node that appears VERBATIM in this snapshot (same role, same name).",
    "- If the element you need is NOT in the snapshot, DO NOT invent a role/name —",
    "  emit the honest source locator (`locator('<css-from-source>')`) plus a",
    "  `// confidence: low — not in DOM snapshot` comment. Never promote a guess.",
    "- An accessible name not present below (e.g. a `getByRole('alert')` or",
    "  `getByRole('button', { name: /close/i })` with no matching node) is a BUG.",
    "",
    "```yaml",
    snapshot.trim(),
    "```",
  ].join("\n");
}

/** Verified-locator hints from the per-app cache (IMP6): locators a prior
 * migration of THIS app confirmed resolve uniquely against the live DOM. Purely
 * additive — empty string when there's no cache for the host or no url. */
function cacheHintsBlock(url: string | null): string {
  if (!url) return "";
  const block = renderCacheHints(loadCache(url), appKey(url));
  return block.length > 0 ? `\n${block}` : "";
}

/** The Stage-2 wrapper prompt — points Claude at the assembled spec + context,
 * mirroring migrate.yml. Profile-aware: lean drops the pwm-blueprint triad/STOP
 * block + style anchor and states the relaxed contract; pwm-blueprint is unchanged.
 * When a DOM snapshot was captured (MIGRATION_TARGET_URL set), it is injected as
 * a closed vocabulary so Stage 2 cannot hallucinate locators; plus any
 * previously-verified locators for this app from the cache (IMP6). */
const DRAFTS_DIR = join(REPO_ROOT, "outputs/.drafts");

/**
 * IMP4 / BP6 — codemod pre-pass. For a Cypress input, run the deterministic
 * Cypress→Playwright codemod and write a Playwright DRAFT sidecar, then return a
 * prompt block pointing Stage 2 at it. Returns "" when the input isn't Cypress,
 * is missing, or the codemod changed nothing (no draft → no noise).
 *
 * Why a draft, not a replacement: the mechanical ~80% (API renames, await
 * insertion, test()-wrapping, hard-wait removal) is deterministic and idempotent
 * — doing it in code removes a class of LLM-variability bugs and shrinks what the
 * model must reason about to the genuinely semantic ~20% (selector strategy,
 * wait→assertion intent, the layered pwm-blueprint architecture).
 */
export function codemodDraftBlock(p: Paths): string {
  if (!/\.cy\.[jt]s$/i.test(p.input) || !existsSync(p.input)) return "";
  const src = readFileSync(p.input, "utf8");
  if (src.length === 0) return "";
  const draft = transformCypress(src);
  const stats = codemodStats(src, draft);
  if (!stats.transformed) return "";
  mkdirSync(DRAFTS_DIR, { recursive: true });
  const draftPath = join(DRAFTS_DIR, `${p.base.replace(/\.cy\.[jt]s$/i, "")}.draft.spec.ts`);
  writeFileSync(draftPath, draft);
  return [
    "",
    "## Deterministic codemod draft (BP6 — the mechanical pre-pass is already done)",
    `A deterministic Cypress→Playwright codemod has pre-translated the UNAMBIGUOUS`,
    `mechanical parts (API renames, await insertion, test()-wrapping, hard-wait removal —`,
    `${stats.hardWaitsRemoved} hard wait(s) removed; ${stats.cyCallsLeft} cy.* call(s) left for you).`,
    `- Draft: ${draftPath}`,
    "Use it as the STARTING POINT for those mechanical transforms — do not redo them.",
    "Your job is the semantic ~20%: selector strategy (getByRole/getByTestId per the plan",
    "+ pwm-blueprint), wait→web-first-assertion intent, and the layered architecture. The",
    "draft is a flat spec, NOT pwm-blueprint-shaped — restructure it to the plan + triad.",
  ].join("\n");
}

export function buildPrompt(p: Paths, profile: Args["profile"], snapshotPath: string | null = null, url: string | null = null): string {
  const assembledRel = profile === "lean"
    ? "prompts/_assembled/generate.lean.md"
    : "prompts/_assembled/generate.md";
  const lead = profile === "lean"
    ? [
      "You are running Stage 2 of the PWmodernizer pipeline (local migrate run, LEAN profile).",
      `Read ${assembledRel} — that is your full system prompt. Follow it exactly.`,
      "Emit a spec (it MAY import test/expect from @playwright/test and MAY call page.goto)",
      "plus a page object per page in the plan. Do NOT produce the fixture barrel or the",
      "api/actions/utilities/test-data/types layers — lean is spec + page object only.",
    ]
    : [
      "You are running Stage 2 of the PWmodernizer pipeline (local migrate run).",
      `Read ${assembledRel} — that is your full system prompt. Follow it`,
      "exactly, including the STOP block: write the FULL pwm-blueprint triad (spec under",
      "outputs/tests/<kebab>.spec.ts importing test/expect from @fixtures/base.fixture,",
      "the PageClass under outputs/helper/page-object/pages/, and the extended",
      "base.fixture) plus any helper layers the plan declares. A spec that imports from",
      "@playwright/test or uses raw `page`/`page.goto` is HARD-REJECTED by the validator.",
    ];
  const context = [
    `1. ${assembledRel} — task spec (READ FIRST)`,
    "2. config/migration-rules.md + config/knowledge-base.md — rules + KB IDs",
  ];
  if (profile !== "lean") context.push("3. examples/reference/pwm-blueprint/ — style anchor");
  context.push(`${context.length + 1}. ${p.plan} and ${p.input}`);
  return [
    ...lead,
    "",
    "## Inputs for this run",
    `- Approved plan (execute it; do not re-plan): ${p.plan}`,
    `- Plan envelope (machine contract): ${p.envelope}`,
    `- Original input (preserve assertion behaviour): ${p.input}`,
    `- Reuse inventory (prefer existing helpers over new): ${INVENTORY_PATH}`,
    "",
    "## Context to load (in this order)",
    ...context,
    codemodDraftBlock(p),
    domGroundingBlock(snapshotPath),
    cacheHintsBlock(url),
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
  const r = runClaudeCli([
    "--model", "claude-sonnet-4-6",
    "--max-turns", "50",
    "--print",
    "--permission-mode", "acceptEdits",
    prompt,
  ], { cwd: REPO_ROOT, env });
  if (!r.ok) fail(r.timedOut ? "Claude generate call timed out (hung CLI) — retry, or raise CLAUDE_CLI_TIMEOUT_MS." : "Claude generate call failed — see output above.");
  process.stdout.write("  [step] Claude generate done\n");
}

/** The post-generate validator wall — same scripts + args as migrate.yml. */
function validatorWall(p: Paths, profile: Args["profile"]): WallStep[] {
  // Parse gate: `playwright test --list` over the literal spec paths (spawnSync
  // takes argv, so no glob — and no --config so PW auto-discovers
  // outputs/tests/playwright.config.ts exactly as migrate.yml does). Skipped
  // cleanly when there are no specs.
  const specs = listOutputSpecs(OUT_DIR);
  const parseGate: WallStep[] = specs.length > 0
    ? [{ name: "playwright test --list (parse)", cmd: "npx", args: ["playwright", "test", "--list", ...specs] }]
    : [];
  return [
    { name: "tsc (outputs/tests)", cmd: "npx", args: ["tsc", "--noEmit", "-p", "outputs/tests/tsconfig.json"] },
    { name: "eslint --fix", cmd: "npx", args: ["eslint", "--fix", "outputs/tests/**/*.ts"] },
    ...parseGate,
    { name: "ast-diff-not-trivial", cmd: "npx", args: ["tsx", "scripts/ast-diff-trivial-check.ts", "--input", p.input, "--output", findGeneratedSpec(OUT_DIR, p.base) ?? "outputs/tests"] },
    { name: "plan-envelope coverage", cmd: "npx", args: ["tsx", "scripts/plan-envelope-validate.ts", "--envelope", p.envelope, "--code", "outputs/tests"] },
    { name: "plan-code coverage", cmd: "npx", args: ["tsx", "scripts/plan-code-coverage.ts", "--envelope", p.envelope, "--output", "outputs/tests"] },
    { name: "assertion coverage (source-equivalence)", cmd: "npx", args: ["tsx", "scripts/assertion-coverage.ts", "--envelope", p.envelope, "--output", findGeneratedSpec(OUT_DIR, p.base) ?? "outputs/tests", ...(process.env["ASSERTION_COVERAGE_STRICT"] === "true" ? ["--strict"] : [])] },
    { name: "helper-usage", cmd: "npx", args: ["tsx", "scripts/validate-helper-usage.ts"] },
    { name: "pwm-blueprint conformance", cmd: "npx", args: ["tsx", "scripts/validate-pwm-blueprint-conformance.ts", "--root", "outputs", "--input-basename", p.base, "--block-defects", ...(profile === "lean" ? ["--profile", "lean"] : [])] },
    // Auth self-contained: a storageState FILE reference with no producer in the
    // tree COMPILES + passes every other gate, but dies at setup (ENOENT) on a
    // real app. Catch it deterministically (zero tokens) instead of at the live
    // execution gate. Found by validating the closed loop on a real GitHub test.
    { name: "auth self-contained", cmd: "npx", args: ["tsx", "scripts/validate-auth-self-contained.ts", "--root", "outputs", "--input-basename", p.base] },
    // A shared page object co-authored by >1 migration is cross-app contamination
    // (the unambiguous half of the batch-mode race a multi-agent hunt found).
    // Deterministic, zero-token; does NOT flag legitimate single-owner reuse.
    { name: "POM provenance (single-migration authorship)", cmd: "npx", args: ["tsx", "scripts/validate-pom-provenance.ts", "--root", "outputs"] },
    // Network completeness (B2): a Cypress source that stubs/asserts a network call
    // (cy.intercept().as() + cy.wait('@x')) whose stub the migration DROPPED passes
    // against the REAL backend for the wrong reason (false green). Source-vs-output
    // presence diff; Cypress-only, self-gates to a trivial pass otherwise.
    { name: "network completeness (no dropped cy.intercept stubs)", cmd: "npx", args: ["tsx", "scripts/validate-network-completeness.ts", "--root", "outputs", "--input-basename", p.base, "--source", p.input] },
    { name: "TODO discipline", cmd: "npx", args: ["tsx", "scripts/validate-todo-discipline.ts", "--root", "outputs/tests", "--root", "outputs/helper"] },
    // URL portability: an absolute http(s):// in a goto / Page url field pins the
    // output to ONE host, so a migration green against staging can't be repointed
    // at prod by swapping baseURL. Converts the soft prompt rule (forbidden-patterns
    // + §1.4.12) into a hard structural gate. Relative URLs (what outputs already
    // emit) pass; only absolute navigation fails.
    { name: "URL portability (relative paths + baseURL)", cmd: "npx", args: ["tsx", "scripts/validate-url-portability.ts", "--root", "outputs"] },
    { name: "report metrics", cmd: "npx", args: ["tsx", "scripts/validate-report-metrics.ts", "--report", p.report, "--input", p.input] },
    // Live-SUT gates (prior-art levers BP2 + BP1), only when MIGRATION_TARGET_URL
    // is set — the static gates above always run.
    //  - BP2 DOM grounding: probe every emitted locator (spec + reachable POMs)
    //    against the LIVE page; a HIGH-confidence locator that does not resolve
    //    uniquely fails (it's a hallucination the real DOM doesn't have). Writes
    //    the probe report evaluate.ts reads to lift the 0.69 unverified cap.
    //  - BP1 execution: RUN the migrated spec against the SUT — green = the
    //    strongest acceptance signal (it actually works), not just "it compiles".
    ...((process.env["MIGRATION_TARGET_URL"] ?? "").trim().length > 0
      ? [
          { name: "DOM grounding vs live SUT (locators resolve)", cmd: "npx", args: ["tsx", "scripts/dom-ground.ts", "--url", (process.env["MIGRATION_TARGET_URL"] ?? "").trim(), "--probe", findGeneratedSpec(OUT_DIR, p.base) ?? OUT_DIR, "--probe-tree", "--report", join(REPO_ROOT, "outputs/reports", `${p.base}-dom-probe.json`), "--mode", "live"] },
          { name: "execution vs live SUT", cmd: "npx", args: ["tsx", "scripts/run-against-sut.ts", "--input-basename", p.base, "--url", (process.env["MIGRATION_TARGET_URL"] ?? "").trim()] },
        ]
      : []),
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

// listOutputSpecs / expectedSpecBasenames / findGeneratedSpec now live in
// ./output-spec.ts (shared with the CI resolver). Imported at the top.

// ---- Cost preview (2E) -----------------------------------------------------

/** Repo-standard chars→tokens heuristic (~4 chars/token; see claude-cached-call.ts). */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Estimate the Stage-2 INPUT cost of a real run from the assembled-prompt size.
 * Reuses metrics.ts computeCostUsd (output_tokens 0) so the price is sourced once.
 * This is a FLOOR: it excludes output tokens and the agentic multi-turn loop. */
export function estimateInputCostUsd(totalChars: number): { tokens: number; usd: number } {
  const tokens = estimateTokensFromChars(totalChars);
  const usd = computeCostUsd({ model: "claude-sonnet-4-6", input_tokens: tokens, output_tokens: 0 }) ?? 0;
  return { tokens, usd };
}

/** Sum the char length of every file the real Stage-2 prompt loads, plus the
 * wrapper. Missing files contribute 0 (a preview must never throw). */
function assembledPromptChars(p: Paths, wrapperPrompt: string, profile: Args["profile"]): number {
  const readChars = (path: string): number => {
    try {
      return existsSync(path) ? readFileSync(path, "utf8").length : 0;
    } catch {
      return 0;
    }
  };
  let total = wrapperPrompt.length;
  for (const f of [
    assembledPromptPath(profile),
    join(REPO_ROOT, "config/migration-rules.md"),
    join(REPO_ROOT, "config/knowledge-base.md"),
    INVENTORY_PATH,
    p.plan,
    p.input,
  ]) {
    total += readChars(f);
  }
  // The pwm-blueprint reference dir is the style anchor — loaded only for pwm-blueprint;
  // lean does not read it (matching buildPrompt's context list).
  if (profile !== "lean") {
    const refDir = join(REPO_ROOT, "examples/reference/pwm-blueprint");
    if (existsSync(refDir)) {
      for (const f of walkFiles(refDir)) total += readChars(f);
    }
  }
  return total;
}

/** Print the zero-token mock preview: wiring + an input-cost floor estimate. */
function printMockPreview(p: Paths, args: Args): void {
  process.stdout.write("\n  [mock] wiring OK. Would invoke:\n");
  process.stdout.write("    npx @anthropic-ai/claude-code --model claude-sonnet-4-6 --max-turns 50 \\\n");
  process.stdout.write("      --print --permission-mode acceptEdits \"<stage-2 prompt>\"\n");
  const { tokens, usd } = estimateInputCostUsd(assembledPromptChars(p, buildPrompt(p, args.profile), args.profile));
  process.stdout.write("\n  [mock] cost preview (Stage 2, claude-sonnet-4-6 input):\n");
  process.stdout.write(`    ~${tokens.toLocaleString()} input tokens, ~$${usd.toFixed(2)} at Sonnet rates (estimate)\n`);
  process.stdout.write("    (input only; excludes output tokens + agentic turns — treat as a floor)\n");
  process.stdout.write("\n  Re-run without --mock (and with auth set) to generate.\n\n");
}

// ---- Batch input expansion (3A) --------------------------------------------

/** Translate a glob tail to an anchored RegExp. `**` spans directory
 * boundaries (`.*`); a single `*` does not (`[^/]*`); `?` is one non-slash char. */
function globTailToRegExp(tail: string): RegExp {
  let re = "";
  for (let j = 0; j < tail.length; j += 1) {
    const c = tail[j] ?? "";
    if (c === "*") {
      if (tail[j + 1] === "*") {
        re += ".*";
        j += 1;
        if (tail[j + 1] === "/") j += 1; // consume the slash in `**/`
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += `\\${c}`;
    } else {
      re += c; // literal, including `/`
    }
  }
  return new RegExp(`^${re}$`);
}

/** Split a normalised glob into its literal leading dir segments and the
 * remaining pattern segments (everything from the first magic char on). */
function splitGlobBase(norm: string): { baseSegs: string[]; patternSegs: string[] } {
  const segs = norm.split("/");
  const baseSegs: string[] = [];
  let i = 0;
  for (; i < segs.length; i += 1) {
    if (/[*?[\]]/.test(segs[i] ?? "")) break;
    baseSegs.push(segs[i] ?? "");
  }
  return { baseSegs, patternSegs: segs.slice(i) };
}

/** Every file under a dir (recursive), skipping the `_legacy-v0.1.x` archive. */
function walkFiles(baseDir: string): string[] {
  const files: string[] = [];
  const stack = [baseDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_legacy-v0.1.x") stack.push(full);
      } else {
        files.push(full);
      }
    }
  }
  return files;
}

/** Expand an input glob to a sorted, de-duplicated list of absolute file paths.
 * Splits a literal base dir off the front, then walks it and regex-matches each
 * file's base-relative POSIX path. No new dependency, no symlink following. */
export function expandInputs(glob: string, repoRoot: string = REPO_ROOT): string[] {
  const norm = glob.replaceAll("\\", "/");
  const { baseSegs, patternSegs } = splitGlobBase(norm);
  // No magic char anywhere → treat the glob as a single literal file path.
  if (patternSegs.length === 0) {
    const full = resolve(repoRoot, norm);
    return existsSync(full) && statSync(full).isFile() ? [full] : [];
  }
  const baseDir = baseSegs.length > 0 ? resolve(repoRoot, baseSegs.join("/")) : repoRoot;
  if (!existsSync(baseDir)) return [];
  const re = globTailToRegExp(patternSegs.join("/"));
  const matches = walkFiles(baseDir)
    .filter((full) => re.test(full.slice(baseDir.length + 1).replaceAll("\\", "/")));
  return [...new Set(matches)].sort((a, b) => a.localeCompare(b));
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
  return out.at(-1) ?? null;
}

/** Run the full Stage-2 pipeline for ONE input. Returns a code instead of
 * exiting on a per-input error so the batch loop can continue to the next file.
 * prepareContext() is run-global and is the CALLER's responsibility (once). */
function runOne(args: Args): { base: string; code: number } {
  const p = derivePaths(args);
  if (!existsSync(p.input)) {
    process.stderr.write(`  ✗ input not found: ${p.input}\n`);
    return { base: basename(p.input), code: 1 };
  }
  if (!existsSync(p.plan)) {
    process.stderr.write(`  ✗ ${p.base}: no approved plan at ${p.plan}\n    Run Stage 1 first: \`npm run plan -- --input ${args.input || "<your-test>"}\` (or plan.yml in CI; \`npm run try-it\` for the bundled demo).\n`);
    return { base: p.base, code: 1 };
  }
  for (const d of [OUT_DIR, dirname(p.report)]) mkdirSync(d, { recursive: true });

  process.stdout.write(`\n  migrate — ${p.base}\n\n`);
  // In --mock, derive the envelope to a throwaway temp path so a wiring check
  // never mutates a committed outputs/plans/<base>.envelope.json.
  if (args.mock) p.envelope = join(tmpdir(), `pwm-mock-${p.base}.envelope.json`);
  if (!deriveEnvelope(p)) return { base: p.base, code: 1 };
  if (!validateEnvelopeSchema(p)) return { base: p.base, code: 1 };

  if (args.mock) {
    printMockPreview(p, args);
    return { base: p.base, code: 0 };
  }

  const auth = detectAuth();
  if (auth.kind === "none") {
    // A global setup error (no auth for ANY input) — hard-stop the whole run.
    fail("no Claude auth. Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY (see --help). Or --mock to check wiring.");
  }
  // --isolate: reset the shared outputs/helper + outputs/tests tree to the
  // committed baseline (basepage/baseblock/base.fixture/logger) BEFORE generating,
  // so this migration starts clean and cannot inherit another migration's POM
  // locators (the cross-migration contamination seen live: a shared login.page.ts
  // carrying saucedemo + the-internet + bad-PW locators at once). Per-migration
  // isolation makes each run independent + reproducible.
  if (args.isolate) resetSharedTree();
  // DOM grounding: when MIGRATION_TARGET_URL is set, capture the target page's
  // accessibility tree and feed it to Stage 2 as a closed vocabulary so it cannot
  // hallucinate locators. Zero model tokens (a Playwright launch); ~free.
  const snapshotPath = captureDomSnapshot(p);
  const sut = (process.env["MIGRATION_TARGET_URL"] ?? "").trim();
  // No SUT to ground against → run the offline abstention gate on the plan before
  // spending Stage-2 tokens. When a snapshot exists, snapshot grounding governs instead.
  if (snapshotPath === null && !offlineAbstentionGate(p)) {
    return { base: p.base, code: 1 };
  }
  // IMP6: inject locators a prior migration of THIS app verified against the live DOM.
  runClaude(auth, buildPrompt(p, args.profile, snapshotPath, sut.length > 0 ? sut : null));

  process.stdout.write("\n  Validator wall (mirrors CI; CI remains authoritative):\n");
  const results = runWall(validatorWall(p, args.profile));
  let code = reportOutcome(p, results);
  // IMP6: persist the locators the DOM-probe gate confirmed resolve-unique for this
  // host, so the next migration of the same app reuses them (cheaper + consistent).
  if (sut.length > 0) {
    const n = recordFromReport(sut, join(REPO_ROOT, "outputs/reports", `${p.base}-dom-probe.json`));
    if (n > 0) process.stdout.write(`  [step] locator cache — ${appKey(sut)} now holds ${n} verified locator(s)\n`);
  }
  // --repair (execution-guided closed loop): if a gate failed and a live SUT is
  // set, run the repair loop — run the migrated test against the SUT, feed the
  // failure + a fresh snapshot back to Claude, re-run, until green (<=3 iter).
  // This makes the proven generate->run->repair loop the default path.
  if (code !== 0 && args.repair && sut.length > 0) {
    process.stdout.write("\n  --repair: a gate failed + a live SUT is set → running execution-guided repair loop ...\n");
    const r = spawnSync("npx", ["tsx", "scripts/repair-loop.ts", "--input-basename", p.base, "--url", sut, "--source", p.input], { cwd: REPO_ROOT, stdio: "inherit" });
    code = r.status ?? 1;
  }
  return { base: p.base, code };
}

/** Run the pipeline over every input matched by --inputs, sequentially (safest
 * for token spend + clean interleaved logs). Exits non-zero if any input fails.
 *
 * With --isolate this is snapshot-and-restore (B3): each runOne resets the shared
 * tree to baseline (so its POMs are authored by exactly one migration), then we
 * ARCHIVE that migration's delta to outputs/.batch/<input>/ before the next reset
 * wipes it — so every migration's output survives for review. The shared tree is
 * restored to baseline at the end. Without --isolate, the batch accumulates into
 * the shared tree (last write wins on shared files like base.fixture). */
function runBatch(args: Args): number {
  const files = expandInputs(args.inputs);
  if (files.length === 0) fail(`--inputs matched 0 files: ${args.inputs}`);
  const isolating = args.isolate && !args.mock;
  process.stdout.write(`\n  migrate batch — ${files.length} input(s) for '${args.inputs}'${args.mock ? " (mock preview)" : ""}${isolating ? " [--isolate: per-input snapshot/restore → outputs/.batch/]" : ""}\n`);
  prepareContext(); // run-global: assemble + inventory once, not per input.
  const results: Array<{ base: string; code: number; archive?: string }> = [];
  for (const f of files) {
    const r = runOne({ ...args, input: f, inputs: "" });
    if (isolating) {
      // Preserve THIS migration's output before the next runOne's reset wipes it.
      const a = archiveIsolatedOutput(r.base);
      results.push(a.files > 0 ? { ...r, archive: a.dir } : r);
    } else {
      results.push(r);
    }
  }
  // Restore the shared tree to the committed baseline so the canonical outputs/
  // don't end up carrying only the last migration's delta. Each migration's
  // reviewable output lives in its outputs/.batch/<input>/ archive.
  if (isolating) resetSharedTree();
  printBatchSummary(results, isolating);
  return results.some((r) => r.code !== 0) ? 1 : 0;
}

/** Print the batch result list (+ per-input archive locations when isolating). */
function printBatchSummary(results: Array<{ base: string; code: number; archive?: string }>, isolating: boolean): void {
  const failed = results.filter((r) => r.code !== 0).length;
  const failedNote = failed > 0 ? `, ${failed} failed` : "";
  process.stdout.write(`\n  Batch summary: ${results.length - failed}/${results.length} succeeded${failedNote}\n`);
  for (const r of results) {
    const loc = r.archive ? ` → ${relative(REPO_ROOT, r.archive)}/` : "";
    process.stdout.write(`    ${r.code === 0 ? "✓" : "✗"} ${r.base}${loc}\n`);
  }
  if (isolating) {
    process.stdout.write("\n  --isolate: each migration's output is archived under outputs/.batch/<input>/ (review one at a time); the shared tree was reset to baseline.\n");
  }
  process.stdout.write("\n");
}

function main(): number {
  const args = parseCliArgs();
  if (args.help) { printHelp(); return 0; }
  if (args.check) return preflight(args);
  // Lean: also relax the eslint step (it reads PWM_PROFILE; child processes
  // inherit process.env). The conformance gate gets --profile lean explicitly.
  if (args.profile === "lean") process.env["PWM_PROFILE"] = "lean";
  if (args.input && args.inputs) fail("use --input OR --inputs, not both.");
  if (args.inputs) return runBatch(args);
  if (!args.input) { printHelp(); fail("--input <path> or --inputs <glob> is required."); }

  prepareContext();
  return runOne(args).code;
}

/**
 * B4.3: true when the printed confidence is the no-live-grounding STRUCTURAL
 * cap — no MIGRATION_TARGET_URL was set, so the live DOM probe never ran and
 * evaluate.ts capped the aggregate at UNVERIFIED_LOCATOR_CONFIDENCE_CAP. This is
 * not a quality verdict; grounding the locators (set a URL) lifts the cap.
 */
export function isStructuralGroundingCap(confidence: number, sut: string): boolean {
  return sut.trim().length === 0 && confidence <= UNVERIFIED_LOCATOR_CONFIDENCE_CAP + 0.001;
}

/** Print the wall results + confidence score; return the process exit code. */
function reportOutcome(p: Paths, results: WallResult[]): number {
  const failed = results.filter((r) => !r.ok);
  // Confidence (informational — same evaluate.ts CI uses to decide if verify fires).
  const spec = findGeneratedSpec(OUT_DIR, p.base);
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
    // B4.3: a migration run WITHOUT MIGRATION_TARGET_URL never runs the live
    // DOM probe, so evaluate.ts caps the aggregate at UNVERIFIED_LOCATOR_CONFIDENCE_CAP
    // (locators are "claimed, not verified"). Surface that the cap is STRUCTURAL
    // (no live grounding) — not a quality verdict — so an offline user doesn't
    // read 0.69 as "the migration is weak". With a URL set, a passing probe
    // lifts the cap and the score reflects real quality.
    const sut = (process.env["MIGRATION_TARGET_URL"] ?? "").trim();
    if (isStructuralGroundingCap(Number(confidence), sut)) {
      process.stdout.write(
        `    note: confidence is CAPPED at ${UNVERIFIED_LOCATOR_CONFIDENCE_CAP} because no MIGRATION_TARGET_URL was set —\n` +
        "          locators were not DOM-grounded against a live page (not a quality verdict).\n" +
        "          Re-run with MIGRATION_TARGET_URL=<url> to ground them and lift the cap.\n",
      );
    }
  }
  if (failed.length > 0) {
    process.stdout.write(`\n  ${failed.length} gate(s) failed — review before trusting the output.\n\n`);
    return 1;
  }
  process.stdout.write("\n  All gates passed. Review the output, then commit.\n\n");
  return 0;
}

// Only run the CLI when invoked directly — importing for tests must not migrate.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
