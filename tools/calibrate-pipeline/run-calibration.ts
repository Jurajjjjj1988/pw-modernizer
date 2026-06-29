#!/usr/bin/env node
/**
 * run-calibration.ts — exercises every gating validator against a known-good
 * and known-bad fixture corpus. Per Sakasegawa 2026, an uncalibrated validator
 * is WORSE than no validator (false confidence). This script proves each
 * validator accepts the goods and rejects the bads BEFORE we let it block CI.
 *
 * Per-fixture contract:
 *   - exit code matches `expectedExit` derived from fixture name prefix
 *     (`good-` -> 0, `bad-` -> 1)
 *   - stdout/stderr contain every substring listed in the golden-output file
 *     (one substring per non-empty, non-comment line; `#`-prefixed are
 *     treated as comments and ignored)
 *
 * Run:
 *   npx tsx tools/calibrate-pipeline/run-calibration.ts
 *   npx tsx tools/calibrate-pipeline/run-calibration.ts --validator kb-validate
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  checkAllSync, type PrSnapshot, type Violation,
} from "../../scripts/lib/danger-rules.js";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);
const FIXTURES_ROOT = join(REPO_ROOT, "tools", "calibrate-pipeline", "fixtures");
const GOLDEN_ROOT = join(REPO_ROOT, "tools", "calibrate-pipeline", "golden-outputs");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");
const FIXTURE_SPLIT = "<!--FIXTURE-SPLIT-->";

type ValidatorName =
  | "kb-validate" | "plan-envelope-validate"
  | "ast-diff-trivial-check" | "validate-examples"
  | "plan-code-coverage" | "dom-ground" | "verify-tally"
  | "danger-policy"
  | "cypress-conformance" | "selenium-python-conformance"
  | "selenium-java-conformance"
  | "pwm-blueprint-conformance"
  | "rag-bm25"
  | "helper-usage"
  | "validate-todo-discipline"
  | "validate-report-metrics"
  | "validate-url-portability"
  | "evaluate"
  | "network-completeness";

const VALIDATORS: readonly ValidatorName[] = [
  "kb-validate", "plan-envelope-validate",
  "ast-diff-trivial-check", "validate-examples",
  "plan-code-coverage", "dom-ground", "verify-tally",
  "danger-policy",
  "cypress-conformance", "selenium-python-conformance",
  "selenium-java-conformance",
  "pwm-blueprint-conformance",
  "rag-bm25",
  "helper-usage",
  "validate-todo-discipline",
  "validate-report-metrics",
  "validate-url-portability",
  "evaluate",
  "network-completeness",
];

/**
 * Validators that share the nested `{good,bad}/<scenario>/` fixture layout.
 * Conformance validators land pwm-blueprint trees per scenario; helper-usage
 * follows the same shape with `<scenario>/helper/api/*.ts` + `<scenario>/
 * tests/*.ts` so the runner branches on a single set.
 */
const NESTED_CONFORMANCE_VALIDATORS: readonly ValidatorName[] = [
  "cypress-conformance",
  "selenium-python-conformance",
  "selenium-java-conformance",
  "pwm-blueprint-conformance",
  "helper-usage",
];

interface FixtureResult {
  fixture: string;
  expectedExit: number;
  actualExit: number;
  missingSubstrings: string[];
  passed: boolean;
}

interface ValidatorReport {
  validator: ValidatorName;
  good: number; goodTotal: number;
  bad: number; badTotal: number;
  results: FixtureResult[];
}

function parseGolden(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function expectedExitFromName(name: string): number {
  if (name.startsWith("good-")) return 0;
  if (name.startsWith("bad-")) return 1;
  throw new Error(`fixture '${name}' must start with 'good-' or 'bad-'`);
}

function listFixtureNames(validator: ValidatorName): string[] {
  const dir = join(FIXTURES_ROOT, validator);
  if (!existsSync(dir)) return [];
  // cypress-conformance + selenium-python-conformance use a nested layout —
  // fixtures live under `good/<scenario>/` and `bad/<scenario>/` because each
  // fixture is a multi-file pwm-blueprint tree (spec + page object + fixture). We
  // synthesise flat names `good-<scenario>` / `bad-<scenario>` so the rest of
  // the runner (expectedExitFromName, golden lookup, printReport) stays
  // agnostic of the on-disk shape.
  if ((NESTED_CONFORMANCE_VALIDATORS as readonly string[]).includes(validator)) {
    const out: string[] = [];
    for (const polarity of ["good", "bad"] as const) {
      const subdir = join(dir, polarity);
      if (!existsSync(subdir)) continue;
      const scenarios = readdirSync(subdir).sort((a, b) => a.localeCompare(b));
      for (const scenario of scenarios) {
        const scenarioPath = join(subdir, scenario);
        if (!statSync(scenarioPath).isDirectory()) continue;
        out.push(`${polarity}-${scenario}`);
      }
    }
    return out;
  }
  return readdirSync(dir)
    .filter((n) => n.startsWith("good-") || n.startsWith("bad-"))
    .sort();
}

function combinedOutput(r: SpawnSyncReturns<string>): string {
  return `${r.stdout}\n${r.stderr}`;
}

function buildResult(
  fixture: string, r: SpawnSyncReturns<string>, golden: string[],
): FixtureResult {
  const out = combinedOutput(r);
  const missing = golden.filter((n) => !out.includes(n));
  const expected = expectedExitFromName(fixture);
  const actual = r.status ?? -1;
  return {
    fixture, expectedExit: expected, actualExit: actual,
    missingSubstrings: missing,
    passed: actual === expected && missing.length === 0,
  };
}

function goldenPath(validator: ValidatorName, stem: string): string {
  return join(GOLDEN_ROOT, validator, `${stem}.expected.txt`);
}

function withTempSandbox<T>(prefix: string, fn: (dir: string) => T): T {
  const sandbox = mkdtempSync(join(tmpdir(), prefix));
  try { return fn(sandbox); }
  finally { rmSync(sandbox, { recursive: true, force: true }); }
}

function runKb(fixtureName: string): FixtureResult {
  const raw = readFileSync(join(FIXTURES_ROOT, "kb-validate", fixtureName), "utf8");
  const splitIdx = raw.indexOf(FIXTURE_SPLIT);
  const kbBody = splitIdx === -1 ? raw : raw.slice(0, splitIdx);
  const rulesBody = splitIdx === -1 ? "" : raw.slice(splitIdx + FIXTURE_SPLIT.length);
  return withTempSandbox("pwm-cal-kb-", (sandbox) => {
    mkdirSync(join(sandbox, "config"), { recursive: true });
    mkdirSync(join(sandbox, "scripts"), { recursive: true });
    mkdirSync(join(sandbox, "prompts"), { recursive: true });
    writeFileSync(join(sandbox, "config", "knowledge-base.md"), kbBody);
    writeFileSync(join(sandbox, "config", "migration-rules.md"), rulesBody);
    cpSync(join(SCRIPTS_DIR, "kb-validate.ts"), join(sandbox, "scripts", "kb-validate.ts"));
    const r = spawnSync("npx", ["tsx", join(sandbox, "scripts", "kb-validate.ts")],
      { cwd: sandbox, encoding: "utf8" });
    const golden = parseGolden(goldenPath("kb-validate", basename(fixtureName, ".md")));
    return buildResult(fixtureName, r, golden);
  });
}

function runEnvelope(fixtureName: string): FixtureResult {
  const fixturePath = join(FIXTURES_ROOT, "plan-envelope-validate", fixtureName);
  const isDir = statSync(fixturePath).isDirectory();
  const envelopeArg = isDir ? join(fixturePath, "envelope.json") : fixturePath;
  const args = ["tsx", join(SCRIPTS_DIR, "plan-envelope-validate.ts"), "--envelope", envelopeArg];
  if (isDir && existsSync(join(fixturePath, "code.ts"))) {
    args.push("--code", join(fixturePath, "code.ts"));
  }
  const r = spawnSync("npx", args, { cwd: REPO_ROOT, encoding: "utf8" });
  const stem = isDir ? fixtureName : basename(fixtureName, ".json");
  return buildResult(fixtureName, r, parseGolden(goldenPath("plan-envelope-validate", stem)));
}

// Output may be .spec.ts (good migration), .py, or .java (bad rename-only
// where the LLM never ported the language).
function findOutputFile(dir: string): string | null {
  const entries = readdirSync(dir);
  const tsHit = entries.find((n) => /^output\.[\w.-]*ts$/.test(n));
  if (tsHit) return tsHit;
  return entries.find((n) => /^output\.(java|py)$/.test(n)) ?? null;
}

// Input may be .ts (legacy), .java (Selenium Java), or .py (Selenium Python).
function findInputFile(dir: string): string | null {
  const entries = readdirSync(dir);
  for (const ext of [".ts", ".java", ".py"]) {
    const hit = entries.find((n) => n === `input${ext}`);
    if (hit) return hit;
  }
  return null;
}

function runAstDiff(fixtureName: string): FixtureResult {
  const fixtureDir = join(FIXTURES_ROOT, "ast-diff-trivial-check", fixtureName);
  // Stem-match regression fixture (commit 041c342): exercise the
  // resolveSourceFile recovery path by passing a deliberately nonexistent
  // --output whose stem matches the real sibling .spec.ts. Without this
  // branch the runner would either skip the fixture (no `output.*` file
  // matches findOutputFile) or read the literal path and crash with ENOENT.
  if (fixtureName === "good-06-stem-match-cross-lang") {
    const r = spawnSync("npx", [
      "tsx", join(SCRIPTS_DIR, "ast-diff-trivial-check.ts"),
      "--input", join(fixtureDir, "input.java"),
      "--output", join(fixtureDir, "EmployeesTest.java"),
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    return buildResult(fixtureName, r, parseGolden(goldenPath("ast-diff-trivial-check", fixtureName)));
  }
  const inputName = findInputFile(fixtureDir);
  const outputName = findOutputFile(fixtureDir);
  if (inputName === null || outputName === null) {
    const missing = inputName === null ? "(no input.* file)" : "(no output.* file)";
    return {
      fixture: fixtureName, expectedExit: expectedExitFromName(fixtureName),
      actualExit: -1, missingSubstrings: [missing], passed: false,
    };
  }
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "ast-diff-trivial-check.ts"),
    "--input", join(fixtureDir, inputName),
    "--output", join(fixtureDir, outputName),
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("ast-diff-trivial-check", fixtureName)));
}

function runValidateExamples(fixtureName: string): FixtureResult {
  const fixturePath = join(FIXTURES_ROOT, "validate-examples", fixtureName);
  return withTempSandbox("pwm-cal-ve-", (sandbox) => {
    mkdirSync(join(sandbox, "config"), { recursive: true });
    mkdirSync(join(sandbox, "scripts"), { recursive: true });
    mkdirSync(join(sandbox, "examples", "calibration-fixture"), { recursive: true });
    // Reuse the live KB so legitimate references (KB-1.1.1, KB-1.3.1, KB-1.4.1)
    // resolve — only the phantom KB-1.99.99 / KB-2.99.99 IDs are rejected.
    cpSync(join(REPO_ROOT, "config", "knowledge-base.md"), join(sandbox, "config", "knowledge-base.md"));
    cpSync(join(SCRIPTS_DIR, "validate-examples.ts"), join(sandbox, "scripts", "validate-examples.ts"));
    cpSync(fixturePath, join(sandbox, "examples", "calibration-fixture", "expected-plan.md"));
    const r = spawnSync("npx", ["tsx", join(sandbox, "scripts", "validate-examples.ts"), "--strict"],
      { cwd: sandbox, encoding: "utf8" });
    const golden = parseGolden(goldenPath("validate-examples", basename(fixtureName, ".md")));
    return buildResult(fixtureName, r, golden);
  });
}

function runPlanCodeCoverage(fixtureName: string): FixtureResult {
  // plan-code-coverage closes the LPW loop end-to-end: each fixture pairs an
  // envelope.json with a code.ts. For multi-file fixtures (e.g. good-02 which
  // references outputs/tests/pages/login.page.ts), the fixture dir itself
  // doubles as a sandbox repo root so requiredPOMs/Fixtures existence checks
  // resolve locally. The flag is a no-op for fixtures with empty arrays.
  const fixtureDir = join(FIXTURES_ROOT, "plan-code-coverage", fixtureName);
  const envelope = join(fixtureDir, "envelope.json");
  const code = join(fixtureDir, "code.ts");
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "plan-code-coverage.ts"),
    "--envelope", envelope,
    "--output", code,
    "--repo-root", fixtureDir,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("plan-code-coverage", fixtureName)));
}

function runDomGround(fixtureName: string): FixtureResult {
  // Each dom-ground fixture has probe.spec.ts + mock-url.txt. Invoke
  // dom-ground in mock mode; the calibration proves the gate logic
  // (resolved-unique → exit 0; not-found/ambiguous → exit 1) end-to-end
  // without needing a real SUT. Live-mode calibration lands when we have
  // a known-stable SUT to point at.
  const fixtureDir = join(FIXTURES_ROOT, "dom-ground", fixtureName);
  const probe = join(fixtureDir, "probe.spec.ts");
  const urlFile = join(fixtureDir, "mock-url.txt");
  const url = readFileSync(urlFile, "utf8").trim();
  const tmpReport = join(tmpdir(), `dom-ground-${fixtureName}.json`);
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "dom-ground.ts"),
    "--url", url,
    "--probe", probe,
    "--report", tmpReport,
    "--mode", "mock",
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("dom-ground", fixtureName)));
}

function runVerifyTally(fixtureName: string): FixtureResult {
  // Each fixture has sdet.md (optional in bad-*), cr.md (optional in bad-*),
  // and expected.txt. The script computes the final tally verdict from the
  // 2 inputs and compares to expected — exits 0 on match, 1 on mismatch.
  const fixtureDir = join(FIXTURES_ROOT, "verify-tally", fixtureName);
  const sdet = join(fixtureDir, "sdet.md");
  const cr = join(fixtureDir, "cr.md");
  const expected = readFileSync(join(fixtureDir, "expected.txt"), "utf8").trim();
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "verify-tally.ts"),
    "--sdet", sdet,
    "--code-review", cr,
    "--expected", expected,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("verify-tally", fixtureName)));
}

interface DangerFixture extends PrSnapshot {
  expectedViolations: Violation["rule"][];
}

/**
 * danger-policy fixtures are flat JSON files describing a PrSnapshot plus
 * an `expectedViolations` list. We invoke the pure-function rule
 * predicates in-process (no spawn) and assert the multiset of fired rule
 * names matches the declaration. No golden-output file — the JSON IS the
 * spec. Per-fixture FixtureResult is synthesised to mesh with printReport.
 */
function runDangerPolicy(fixtureName: string): FixtureResult {
  const fixturePath = join(FIXTURES_ROOT, "danger-policy", fixtureName);
  const expectedExit = expectedExitFromName(fixtureName);
  const raw = readFileSync(fixturePath, "utf8");
  const fx = JSON.parse(raw) as DangerFixture;
  const byLocale = (a: string, b: string): number => a.localeCompare(b);
  const expected: string[] = [...fx.expectedViolations].map(String).sort(byLocale);
  const actual: string[] = checkAllSync(fx).map((v) => v.rule as string).sort(byLocale);
  // Multiset diff catches both missing AND unexpected rule firings.
  const remaining = [...actual];
  const missing: string[] = [];
  for (const want of expected) {
    const i = remaining.indexOf(want);
    if (i === -1) missing.push(want);
    else remaining.splice(i, 1);
  }
  const passed = missing.length === 0 && remaining.length === 0;
  const missingMsgs = [
    ...missing.map((r) => `missing rule '${r}'`),
    ...remaining.map((r) => `unexpected rule '${r}'`),
  ];
  const invertedExit = expectedExit === 0 ? 1 : 0;
  return {
    fixture: fixtureName,
    expectedExit,
    actualExit: passed ? expectedExit : invertedExit,
    missingSubstrings: missingMsgs,
    passed,
  };
}

/**
 * cypress-conformance + selenium-python-conformance fixtures are nested
 * `{good,bad}/<scenario>/` pwm-blueprint trees (spec + page object + base
 * fixture). Each fixture is invoked by pointing
 * `validate-pwm-blueprint-conformance.ts --root <scenario-dir>` at the scenario
 * root and asserting exit code matches the polarity (good → 0, bad → 1) plus
 * the golden substring set.
 *
 * The synthetic fixture name `good-<scenario>` / `bad-<scenario>` is split
 * back into polarity + scenario to resolve the on-disk path. We split on the
 * FIRST `-` only — scenario names themselves contain `-` (e.g.
 * `01-selenium-python-pytest-login`).
 */
function runConformance(
  validator: "cypress-conformance" | "selenium-python-conformance" | "selenium-java-conformance",
  fixtureName: string,
): FixtureResult {
  const sepIdx = fixtureName.indexOf("-");
  const polarity = fixtureName.slice(0, sepIdx);
  const scenario = fixtureName.slice(sepIdx + 1);
  const fixtureRoot = join(FIXTURES_ROOT, validator, polarity, scenario);
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "validate-pwm-blueprint-conformance.ts"),
    "--root", fixtureRoot,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath(validator, fixtureName)));
}

function runCypressConformance(fixtureName: string): FixtureResult {
  return runConformance("cypress-conformance", fixtureName);
}

function runSeleniumPythonConformance(fixtureName: string): FixtureResult {
  return runConformance("selenium-python-conformance", fixtureName);
}

function runSeleniumJavaConformance(fixtureName: string): FixtureResult {
  return runConformance("selenium-java-conformance", fixtureName);
}

// pwm-blueprint-conformance fixtures exercise the conformance validator's own
// scoping + defect-class paths (not a source-language migration). Same nested
// `{good,bad}/<scenario>/` layout, but a scenario may need extra validator flags
// — e.g. the scope-miss fixture is driven WITH `--input-basename test_x.py`, and
// the try/catch-in-spec defect blocks only under `--block-defects`. Each scenario
// declares them in an optional whitespace-separated `flags.txt`; absent → no
// extra flags (a plain `--root` run, like the language-conformance fixtures).
function runPwmBlueprintConformance(fixtureName: string): FixtureResult {
  const sepIdx = fixtureName.indexOf("-");
  const polarity = fixtureName.slice(0, sepIdx);
  const scenario = fixtureName.slice(sepIdx + 1);
  const fixtureRoot = join(FIXTURES_ROOT, "pwm-blueprint-conformance", polarity, scenario);
  const flagsFile = join(fixtureRoot, "flags.txt");
  const extraFlags = existsSync(flagsFile)
    ? readFileSync(flagsFile, "utf8").split(/\s+/).filter((s) => s.length > 0)
    : [];
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "validate-pwm-blueprint-conformance.ts"),
    "--root", fixtureRoot,
    ...extraFlags,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("pwm-blueprint-conformance", fixtureName)));
}

// helper-usage fixtures use the same nested `{good,bad}/<scenario>/` layout as
// the conformance trees but invoke a different validator. Each scenario root
// contains `helper/api/*.ts` (the exports) and `tests/*.ts` (consumers); we
// point the validator at both via its `--api-dir` and `--consumer-root` flags.
// Good fixtures: every exported helper is consumed → exit 0.
// Bad fixtures: at least one exported helper is dead → exit 1 (under --strict).
function runHelperUsage(fixtureName: string): FixtureResult {
  const sepIdx = fixtureName.indexOf("-");
  const polarity = fixtureName.slice(0, sepIdx);
  const scenario = fixtureName.slice(sepIdx + 1);
  const fixtureRoot = join(FIXTURES_ROOT, "helper-usage", polarity, scenario);
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "validate-helper-usage.ts"),
    "--strict",
    "--api-dir", join(fixtureRoot, "helper", "api"),
    "--consumer-root", fixtureRoot,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("helper-usage", fixtureName)));
}

// rag-bm25 fixtures live under fixtures/rag-bm25/<name>/ with a pre-built
// `index.json` + an `input.<ext>` query file. The runner spawns
// `scripts/retrieval-bm25.ts` against the fixture index and verifies the
// resulting JSON contains the golden substrings (Phase 1, ADR-0001).
function runRagBm25(fixtureName: string): FixtureResult {
  const fixtureDir = join(FIXTURES_ROOT, "rag-bm25", fixtureName);
  const indexPath = join(fixtureDir, "index.json");
  const inputCandidates = readdirSync(fixtureDir)
    .filter((n) => n.startsWith("input."));
  if (inputCandidates.length === 0) {
    return {
      fixture: fixtureName, expectedExit: expectedExitFromName(fixtureName),
      actualExit: -1, missingSubstrings: [],
      passed: false,
    };
  }
  const inputPath = join(fixtureDir, inputCandidates[0]!);
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "retrieval-bm25.ts"),
    "--input", inputPath,
    "--index", indexPath,
    "--k", "3",
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("rag-bm25", fixtureName)));
}

// validate-todo-discipline fixtures are FLAT single-file scanners — each
// fixture is one `good-NN-*.ts` / `bad-NN-*.ts` file directly under the
// fixture dir. The scanner walks directories (not bare files) via
// `--root <dir>`, so we copy the lone fixture into a temp sandbox and point
// the scanner at that dir. Good fixtures carry only justified TODO forms
// (Q<n>, ticket id, `fragile selector`, `add testid`, `#<issue>`); bad
// fixtures each trip exactly one rejection mode (bare TODO, no-colon TODO,
// unjustified HACK).
function runTodoDiscipline(fixtureName: string): FixtureResult {
  const fixturePath = join(FIXTURES_ROOT, "validate-todo-discipline", fixtureName);
  return withTempSandbox("pwm-cal-todo-", (sandbox) => {
    const scanRoot = join(sandbox, "src");
    mkdirSync(scanRoot, { recursive: true });
    cpSync(fixturePath, join(scanRoot, fixtureName));
    const r = spawnSync("npx", [
      "tsx", join(SCRIPTS_DIR, "validate-todo-discipline.ts"),
      "--root", scanRoot,
    ], { cwd: sandbox, encoding: "utf8" });
    const golden = parseGolden(goldenPath("validate-todo-discipline", basename(fixtureName, ".ts")));
    return buildResult(fixtureName, r, golden);
  });
}

// validate-report-metrics fixtures are nested `{good,bad}-NN/` dirs, each
// containing report.md + the referenced source input file (kept under its
// REAL basename, e.g. EmployeesTest.java, because the script derives the
// expected spec basename from the input file's own name) + an emitted spec on
// disk at `outputs/tests/<x>.spec.ts`. The script resolves the report's spec
// reference against CWD, so we spawn with `cwd` = fixture dir. The input file
// is the lone dir-root file that isn't report.md. Bad fixtures each trip ONE
// mode: basename mismatch, claimed-LOC drift, or delta inconsistency.
function runReportMetrics(fixtureName: string): FixtureResult {
  const fixtureDir = join(FIXTURES_ROOT, "validate-report-metrics", fixtureName);
  const report = join(fixtureDir, "report.md");
  const inputName = readdirSync(fixtureDir).find((n) =>
    n !== "report.md" && statSync(join(fixtureDir, n)).isFile());
  if (inputName === undefined) {
    return {
      fixture: fixtureName, expectedExit: expectedExitFromName(fixtureName),
      actualExit: -1, missingSubstrings: ["(no source input file)"], passed: false,
    };
  }
  const input = join(fixtureDir, inputName);
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "validate-report-metrics.ts"),
    "--report", report,
    "--input", input,
  ], { cwd: fixtureDir, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("validate-report-metrics", fixtureName)));
}

function runUrlPortability(fixtureName: string): FixtureResult {
  const fixtureDir = join(FIXTURES_ROOT, "validate-url-portability", fixtureName);
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "validate-url-portability.ts"),
    "--root", fixtureDir,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("validate-url-portability", fixtureName)));
}

// evaluate fixtures are flat `{good,bad}-NN-*/` dirs, each holding input.ts +
// a `*.spec.ts` emitted output + plan.md. evaluate.ts is the post-generation
// SCORER that is also a GATE: it hard-rejects (exit 1) a zero-assertion tree OR
// a tree containing a hard-forbidden pattern (force:true, page.pause(), test.only,
// as-unknown-as, runtime test.skip/test.todo/test.fixme), else exits 0. The spec
// stem is intentionally unique (`pwm-calib-eval-*`) so no real outputs/helper file
// joins the emitted tree. report-out + METRICS_DB are routed into the sandbox so
// the run touches nothing committed.
function runEvaluate(fixtureName: string): FixtureResult {
  const fixtureDir = join(FIXTURES_ROOT, "evaluate", fixtureName);
  const entries = readdirSync(fixtureDir);
  const input = join(fixtureDir, "input.ts");
  const plan = join(fixtureDir, "plan.md");
  const specName = entries.find((n) => n.endsWith(".spec.ts"));
  if (specName === undefined) {
    return {
      fixture: fixtureName, expectedExit: expectedExitFromName(fixtureName),
      actualExit: -1, missingSubstrings: ["(no *.spec.ts output file)"], passed: false,
    };
  }
  return withTempSandbox("pwm-cal-eval-", (sandbox) => {
    const r = spawnSync("npx", [
      "tsx", join(SCRIPTS_DIR, "evaluate.ts"),
      "--input", input,
      "--output", join(fixtureDir, specName),
      "--plan", plan,
      "--report-out", join(sandbox, "report.md"),
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, METRICS_DB: join(sandbox, ".metrics.db") },
    });
    return buildResult(fixtureName, r, parseGolden(goldenPath("evaluate", fixtureName)));
  });
}
// network-completeness fixtures are `{good,bad}-NN-*/` dirs, each a small emitted
// tree: a legacy `source.cy.js`, a `tests/<spec>.spec.ts`, and (for the
// fixture-only-stub case) `helper/fixtures/*-mocks.fixture.ts`. The validator is
// pointed at the fixture dir via `--root`, deriving the input basename from the
// source filename so findGeneratedSpec resolves the spec. Good fixtures reflect
// every intercept (spy→waitForResponse, stub→route, fixture-only stub seen by the
// directory scan) → exit 0; bad fixtures drop a stub → exit 1.
function runNetworkCompleteness(fixtureName: string): FixtureResult {
  const fixtureDir = join(FIXTURES_ROOT, "network-completeness", fixtureName);
  const sourceName = readdirSync(fixtureDir).find((n) => n.startsWith("source."));
  if (sourceName === undefined) {
    return {
      fixture: fixtureName, expectedExit: expectedExitFromName(fixtureName),
      actualExit: -1, missingSubstrings: ["(no source.* file)"], passed: false,
    };
  }
  const r = spawnSync("npx", [
    "tsx", join(SCRIPTS_DIR, "validate-network-completeness.ts"),
    "--root", fixtureDir,
    "--input-basename", sourceName,
    "--source", join(fixtureDir, sourceName),
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return buildResult(fixtureName, r, parseGolden(goldenPath("network-completeness", fixtureName)));
}

const FIXTURE_RUNNERS: Record<ValidatorName, (name: string) => FixtureResult> = {
  "kb-validate": runKb,
  "plan-envelope-validate": runEnvelope,
  "ast-diff-trivial-check": runAstDiff,
  "validate-examples": runValidateExamples,
  "plan-code-coverage": runPlanCodeCoverage,
  "dom-ground": runDomGround,
  "verify-tally": runVerifyTally,
  "danger-policy": runDangerPolicy,
  "cypress-conformance": runCypressConformance,
  "selenium-python-conformance": runSeleniumPythonConformance,
  "selenium-java-conformance": runSeleniumJavaConformance,
  "pwm-blueprint-conformance": runPwmBlueprintConformance,
  "rag-bm25": runRagBm25,
  "helper-usage": runHelperUsage,
  "validate-todo-discipline": runTodoDiscipline,
  "validate-report-metrics": runReportMetrics,
  "validate-url-portability": runUrlPortability,
  "evaluate": runEvaluate,
  "network-completeness": runNetworkCompleteness,
};

function runValidator(validator: ValidatorName): ValidatorReport {
  const fixtures = listFixtureNames(validator);
  const results = fixtures.map((n) => FIXTURE_RUNNERS[validator](n));
  const goods = results.filter((r) => r.expectedExit === 0);
  const bads = results.filter((r) => r.expectedExit === 1);
  return {
    validator,
    good: goods.filter((r) => r.passed).length, goodTotal: goods.length,
    bad: bads.filter((r) => r.passed).length, badTotal: bads.length,
    results,
  };
}

/**
 * Hollow-green guard (NON-failing): a validator proving only one side is
 * calibration theatre — e.g. rag-bm25 once had 5 good + 0 bad, so [OK] meant
 * "never rejects anything". Returns a warning line (or "") without affecting the
 * exit code. danger-policy is exempt: its fixtures carry no golden by design
 * (the emitted JSON IS the spec), so a one-sided corpus is not hollow there.
 */
function underCalibratedWarning(rep: ValidatorReport): string {
  if (rep.validator === "danger-policy") return "";
  if (rep.goodTotal !== 0 && rep.badTotal !== 0) return "";
  const side = rep.goodTotal === 0 ? "good" : "bad";
  return `       [WARN under-calibrated] ${rep.validator} has zero ${side} fixtures — ` +
    `green proves only one side. Add ${side} fixtures before trusting this gate.\n`;
}

function printReport(reports: ValidatorReport[]): boolean {
  let allPassed = true;
  for (const rep of reports) {
    const passed = rep.good + rep.bad;
    const total = rep.goodTotal + rep.badTotal;
    const allGreen = passed === total;
    if (!allGreen) allPassed = false;
    process.stdout.write(
      `[${allGreen ? "OK " : "FAIL"}] ${rep.validator}: ${passed}/${total} fixtures passed ` +
      `(${rep.good}/${rep.goodTotal} good + ${rep.bad}/${rep.badTotal} bad)\n`,
    );
    process.stdout.write(underCalibratedWarning(rep));
    for (const r of rep.results) {
      if (r.passed) continue;
      const missing = r.missingSubstrings.length > 0
        ? `; missing substrings: ${r.missingSubstrings.map((s) => JSON.stringify(s)).join(", ")}`
        : "";
      process.stdout.write(
        `       - ${r.fixture}: expected exit ${r.expectedExit}, got ${r.actualExit}${missing}\n`,
      );
    }
  }
  return allPassed;
}

function assertValidator(name: string): ValidatorName {
  if ((VALIDATORS as readonly string[]).includes(name)) return name as ValidatorName;
  throw new Error(`unknown validator '${name}' — choose one of ${VALIDATORS.join(", ")}`);
}

function main(): number {
  const { values } = parseArgs({ options: { validator: { type: "string" } } });
  const requested = values.validator === undefined
    ? VALIDATORS
    : [assertValidator(values.validator)];
  const reports = requested.map(runValidator);
  return printReport(reports) ? 0 : 1;
}

process.exit(main());
