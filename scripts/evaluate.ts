#!/usr/bin/env node
/**
 * evaluate.ts — produces `outputs/reports/<input>.md` with concrete metrics.
 *
 * Runs in migrate.yml after the generation step. Outputs to stdout a single
 * `confidence` number (0..1) that the workflow uses to decide whether to
 * trigger verify.yml.
 *
 * Metrics produced (per migration-rules.md §9 + knowledge-base.md §7):
 *   - Compile/parse pass (binary)
 *   - Selector quality score (role/label/testid count vs nth/CSS/XPath)
 *   - Web-first assertion rate
 *   - Smell count delta vs source (Magic Number, Hard Wait, Eager, etc.)
 *   - Forbidden patterns present (list)
 *   - AST-diff-not-trivial flag
 *   - Plan confidence aggregate (read from outputs/plans/<input>.md)
 *
 * Run:
 *   npx tsx scripts/evaluate.ts \
 *     --input inputs/bad-playwright/foo.spec.ts \
 *     --plan outputs/plans/foo.spec.ts.md \
 *     --output outputs/tests/foo.spec.ts \
 *     --report-out outputs/reports/foo.spec.ts.md
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { MetricsDB, type UsageStats } from "./metrics.js";
import { parseLocatorTable, normaliseConfidence } from "./derive-envelope.js";

/**
 * Load a UsageStats JSON file emitted by extract-claude-usage.ts. Missing or
 * malformed → returns null (row persists as "untracked" — dashboard treats
 * cost_usd IS NULL as "no data", not zero).
 */
function loadUsageStats(path: string | undefined): UsageStats | null {
  if (!path || !existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Partial<UsageStats>;
    if (typeof obj.model !== "string" || typeof obj.input_tokens !== "number" || typeof obj.output_tokens !== "number") {
      return null;
    }
    return obj as UsageStats;
  } catch {
    return null;
  }
}

interface Args {
  input: string;
  plan: string;
  output: string;
  "report-out": string;
  /** Optional path to UsageStats JSON from extract-claude-usage.ts. */
  usage?: string;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      plan: { type: "string" },
      output: { type: "string" },
      "report-out": { type: "string" },
      usage: { type: "string" },
    },
  });
  for (const k of ["input", "plan", "output", "report-out"] as const) {
    if (!values[k]) {
      throw new Error(`--${k} is required`);
    }
  }
  return values as unknown as Args;
}

// ---- Smell detectors (regex-based; defensible for v0).
// Per arxiv:2410.10628 these counts dominate "is this a good test" judgement.
interface SmellCount {
  hardWaits: number;
  magicNumbers: number;
  forcedClicks: number;
  nthSelectors: number;
  cssClassSelectors: number;
  pagePauses: number;
  testOnly: number;
  testSkip: number;
  anyType: number;
  consoleLog: number;
  nonWebFirstAsserts: number;
  conditionalInTest: number;
  assertionRoulette: number;
}

function emptySmells(): SmellCount {
  return {
    hardWaits: 0,
    magicNumbers: 0,
    forcedClicks: 0,
    nthSelectors: 0,
    cssClassSelectors: 0,
    pagePauses: 0,
    testOnly: 0,
    testSkip: 0,
    anyType: 0,
    consoleLog: 0,
    nonWebFirstAsserts: 0,
    conditionalInTest: 0,
    assertionRoulette: 0,
  };
}

export function countSmells(rawSource: string): SmellCount {
  const c = emptySmells();
  // Strip comments before pattern detection — comments often reference the
  // ORIGINAL smell (e.g., 'replaces waitForTimeout(7000) from line 25') as
  // documentation, not as a re-introduction of the smell. False-positives
  // from comment-scanning artificially inflate output-smell counts and
  // depress confidence scores. The same logic is applied before LCS overlap.
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  // Hard waits (Playwright + Cypress + Selenium variants).
  c.hardWaits += (source.match(/waitForTimeout\s*\(/g) ?? []).length;
  c.hardWaits += (source.match(/cy\.wait\s*\(\s*\d+/g) ?? []).length;
  c.hardWaits += (source.match(/Thread\.sleep\s*\(/g) ?? []).length;
  c.hardWaits += (source.match(/time\.sleep\s*\(/g) ?? []).length;

  // Magic numbers in test bodies — integers >= 2 not in array index context.
  // Conservative: count any standalone integer >= 100 (timeouts).
  c.magicNumbers += (source.match(/\b\d{3,}\b/g) ?? []).length;

  // Forced actions bypass actionability — almost always wrong.
  c.forcedClicks += (source.match(/\.\s*(click|fill|check)\s*\([^)]*force\s*:\s*true/g) ?? [])
    .length;

  // Index-based selectors.
  c.nthSelectors += (source.match(/\.nth\s*\(/g) ?? []).length;
  c.nthSelectors += (source.match(/\.eq\s*\(\s*\d/g) ?? []).length;
  c.nthSelectors += (source.match(/findElements?\([^)]*\)\.get\s*\(\s*\d/g) ?? []).length;

  // CSS class as primary selector — `page.locator('.foo')` patterns.
  c.cssClassSelectors += (source.match(/\.locator\s*\(\s*['"`]\.[a-zA-Z]/g) ?? []).length;
  c.cssClassSelectors += (source.match(/cy\.get\s*\(\s*['"`]\.[a-zA-Z]/g) ?? []).length;

  // Debug surface left in.
  c.pagePauses += (source.match(/page\.pause\s*\(\s*\)/g) ?? []).length;
  c.pagePauses += (source.match(/cy\.pause\s*\(\s*\)/g) ?? []).length;

  c.testOnly += (source.match(/test\.only\s*\(/g) ?? []).length;
  c.testOnly += (source.match(/it\.only\s*\(/g) ?? []).length;
  c.testOnly += (source.match(/describe\.only\s*\(/g) ?? []).length;

  c.testSkip += (source.match(/test\.skip\s*\(/g) ?? []).length;
  c.testSkip += (source.match(/it\.skip\s*\(/g) ?? []).length;

  c.anyType += (source.match(/:\s*any\b/g) ?? []).length;
  c.anyType += (source.match(/\bas\s+unknown\s+as\b/g) ?? []).length;

  c.consoleLog += (source.match(/console\.log\s*\(/g) ?? []).length;

  // Non-web-first assertions — anti-pattern in Playwright.
  // Total expects minus awaited expects = sync probes. Calibrated 2026-06-10
  // with `webFirstAssertionRate` against PR #13 (was undercounting Bullet 15
  // `expect(capturedMessage).toBe()` calls because the legacy regex only
  // matched `.isVisible()`-style direct probes).
  const totalExpects = (source.match(/\bexpect\s*\(/g) ?? []).length;
  const awaitedExpects = (source.match(/await\s+expect\s*\(/g) ?? []).length;
  c.nonWebFirstAsserts += Math.max(0, totalExpects - awaitedExpects);

  // Conditional logic inside test bodies (true smell, but very hard to
  // count without AST — conservative: search for `if (` after `test(`.
  const testBodies = source.matchAll(/test\s*\([\s\S]*?\)\s*=>\s*\{[\s\S]*?\n\s*\}\s*\)/g);
  for (const m of testBodies) {
    c.conditionalInTest += (m[0].match(/\n\s*if\s*\(/g) ?? []).length;
    // Assertion Roulette (KB 1.1.10 / migration-rules §7.5): many awaited
    // assertions crammed into one test body make a failure ambiguous (which
    // expect failed, on what?). True roulette also asserts on UNRELATED
    // subjects — reliably distinguishing that from a coherent compound check
    // needs AST data-flow, so this is a deliberately LOW-RECALL v0 proxy: flag
    // a body with > 4 awaited expects. The threshold is §7.5's "count > 3"
    // bumped to 4 to clear the common, legitimate 4-field form-save check (a
    // 5th awaited expect in one test is where ambiguity starts to bite). One
    // +1 per offending body, like conditionalInTest. NOTE: the non-greedy
    // body regex truncates at the first `\n})`, so awaited expects nested in a
    // `test.step(...)` / inner callback are under-counted — accepted for v0;
    // subject-distinctness + nested-scope detection is the ts-morph v1 upgrade.
    // Demoted to a non-blocking review-note in capture-failure.ts (web-first
    // asserts are partly idiomatic), so it lowers confidence but never hard-blocks.
    if ((m[0].match(/await\s+expect\s*\(/g) ?? []).length > 4) {
      c.assertionRoulette += 1;
    }
  }

  return c;
}

// ---- Selector quality (verified-canonical / unverified-canonical / fragile).
// A canonical locator (getByRole/Label/TestId/…) is only as trustworthy as its
// PROVENANCE: one the model invented (no source/DOM evidence) is a hallucination
// that ships green. Stage 2 hedges such guesses with comment markers
// ("Qn unresolved", "assumed", "Reviewer fallback", "ask FE to add data-testid",
// "if DOM …"). We treat a canonical locator sitting next to such a marker as
// UNVERIFIED and credit it at half, so a hallucinated getByTestId no longer
// scores identical to a confirmed one.
interface SelectorMix {
  canonicalVerified: number; // canonical locator with no uncertainty hedge nearby
  canonicalUnverified: number; // canonical locator hedged by an uncertainty marker
  fragile: number; // nth, locator('css'), xpath, eq()
}

const CANONICAL_RE = /getBy(?:Role|Label|TestId|Placeholder|Text|AltText|Title)\s*\(/g;
// Stage-2 hedge vocabulary — a canonical locator near any of these is a guess.
const UNCERTAINTY_MARKERS: RegExp[] = [
  /\bunresolved\b/i, /not\s+confirmed/i, /\bunconfirmed\b/i, /\bassume[ds]?\b/i,
  /\bfall(?:s|ing)?\s*back\b/i, /\bfallback\b/i, /\bask\s+(?:the\s+)?(?:fe|front)/i,
  /add\s+(?:a\s+)?`?data-testid/i, /\bif\s+(?:the\s+)?dom\b/i, /\bmay\s+be\b/i,
  /\bmight\s+be\b/i, /\bguess(?:ed|ing)?\b/i, /\blow[- ]conf/i, /\bTODO\b/, /\bFIXME\b/,
];
const isHedged = (window: string): boolean => UNCERTAINTY_MARKERS.some((re) => re.test(window));

export function selectorMix(source: string): SelectorMix {
  const lines = source.split("\n");
  let canonicalVerified = 0;
  let canonicalUnverified = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const n = (line.match(CANONICAL_RE) ?? []).length;
    if (n === 0) continue;
    // Hedge comments precede or trail the locator field — scan a small window.
    const window = `${lines[i - 2] ?? ""}\n${lines[i - 1] ?? ""}\n${line}`;
    if (isHedged(window)) canonicalUnverified += n;
    else canonicalVerified += n;
  }
  const fragile =
    (source.match(/\.nth\s*\(/g) ?? []).length +
    (source.match(/\.eq\s*\(\s*\d/g) ?? []).length +
    (source.match(/\.locator\s*\(\s*['"`][.#:[]/g) ?? []).length +
    (source.match(/xpath\s*=\s*['"`]/g) ?? []).length;
  return { canonicalVerified, canonicalUnverified, fragile };
}

export function selectorQualityScore(mix: SelectorMix): number {
  const total = mix.canonicalVerified + mix.canonicalUnverified + mix.fragile;
  // No selector signal at all is NOT a free perfect score — it is absence of
  // evidence. Return a neutral 0.5 instead of the old 1.0.
  if (total === 0) return 0.5;
  // Verified canonical = full credit; unverified (hedged guess) = half; fragile = 0.
  return (mix.canonicalVerified + 0.5 * mix.canonicalUnverified) / total;
}

// ---- Web-first assertion rate.
//
// Definition (per migration-rules.md §5): web-first means `await expect(loc).<matcher>()`
// where loc is a Playwright Locator and the matcher is retrying. Sync probes
// like `expect(stringVar).toBe(...)`, `expect(await x.isVisible()).toBe(...)`,
// `expect(dialog.message()).toBe(...)` are NOT web-first — they assert on a
// snapshot value, no retry.
//
// Counting: every `expect(...)` call in the spec is one assertion. The web-first
// numerator is the subset preceded by `await`. The legacy sync regex only
// matched `expect(X.text()).toBe()` shapes — it missed plain `expect(var).toBe()`
// (PR #13 verify Code Review block-severity finding: report claimed 100% but
// actual was 50% because Bullet 15's `expect(capturedMessage).toBe()` calls
// weren't detected). Calibrated 2026-06-10.
function webFirstAssertionRate(source: string): number {
  const totalExpects = (source.match(/\bexpect\s*\(/g) ?? []).length;
  if (totalExpects === 0) return 1;
  const webFirst = (source.match(/await\s+expect\s*\(/g) ?? []).length;
  return webFirst / totalExpects;
}

// ---- Forbidden patterns hard list. Strip comments first to avoid flagging
// references in WHY-comments (e.g., "// replaces waitForTimeout(7000)").
//
// Also flags NON-FUNCTIONAL placeholder CODE that survives comment-stripping —
// an LLM that punts with `throw new Error('not implemented')` or a `test.todo`
// stub ships a test that asserts nothing yet reads as smell-free. This is
// distinct from the comment-TODO discipline owned by validate-todo-discipline.ts
// (which scans raw comment lines in outputs/); here we only catch executable
// placeholders. NB: findForbidden runs over outputs/ via evaluate.ts and is
// never invoked by calibration, so the intentional `test.fixme(` calls in
// examples/reference/pwm-blueprint/tests/** are out of scope and not flagged.
export function findForbidden(rawSource: string): string[] {
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const hits: string[] = [];
  if (/waitForTimeout/.test(source)) hits.push("waitForTimeout");
  if (/force\s*:\s*true/.test(source)) hits.push("force: true");
  if (/page\.pause\s*\(/.test(source)) hits.push("page.pause()");
  if (/test\.only\s*\(/.test(source)) hits.push("test.only");
  if (/test\.skip\s*\(/.test(source)) hits.push("test.skip");
  if (/:\s*any\b/.test(source)) hits.push("`: any` type");
  if (/\bas\s+unknown\s+as\b/.test(source)) hits.push("as unknown as cast");
  if (/console\.log\s*\(/.test(source)) hits.push("console.log");
  // Placeholder code: a thrown not-implemented error punting real work. Anchored
  // to the `throw new Error(<message>)` construct so a plain `const s = 'TODO'`
  // string literal never matches — only an executable punt does. (Known v0 edge:
  // a backtick message containing an apostrophe stops the char-class early, e.g.
  // `` `it's not implemented` `` — rare, accepted.)
  if (/throw\s+new\s+Error\s*\(\s*[`'"][^`'"]*\b(not\s+(yet\s+)?implemented|unimplemented|todo|fixme)\b/i.test(source)) {
    hits.push("throw new Error('not implemented') placeholder");
  }
  // Pending-test placeholders — a `.todo`/`.fixme` block never runs its body.
  if (/\b(test|it)\.(todo|fixme)\s*\(/.test(source)) {
    hits.push("test.todo/test.fixme placeholder");
  }
  return hits;
}

// ---- Assertion floor (gate).
//
// A migrated test whose combined emitted tree asserts NOTHING passes silently —
// the runner reports green, `webFirstAssertionRate` returns 1.0 (vacuously: no
// expects, no non-web-first), and the migration reads as high quality while
// verifying nothing. This is the one failure the static scorer otherwise can't
// see. We gate on an absolute floor over the EMITTED tree (spec + helpers).
//
// Deliberately emitted-side only: we do NOT compare against the source's
// assertion count. The pipeline is DESIGNED to consolidate brittle source probes
// (`expect(await x.isVisible()).toBe(true)`) into fewer web-first assertions, so
// a source-vs-emitted ratio would fight the tool's own goal and false-positive on
// faithful migrations. "Asserts at least once" is the principled, false-positive-
// free bound; a retained-ratio signal, if ever wanted, belongs in a WARN line.
const ASSERTION_FLOOR = 1;

interface AssertionFloorResult {
  emitted: number;
  floor: number;
  passed: boolean;
}

/** Count assertions in the emitted tree — every `expect(` after comments are
 * stripped (so a `// replaces expect(...)` doc-comment never inflates the count). */
export function countAssertions(emittedSrc: string): number {
  const source = emittedSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return (source.match(/\bexpect\s*\(/g) ?? []).length;
}

/** A migration must emit at least ASSERTION_FLOOR assertions or it is a silent
 * no-op. Pure + exported for unit testing the gate decision. */
export function checkAssertionFloor(emitted: number): AssertionFloorResult {
  return { emitted, floor: ASSERTION_FLOOR, passed: emitted >= ASSERTION_FLOOR };
}

// ---- Plan confidence aggregate. Read the plan markdown, count HIGH/MED/LOW.
interface PlanConfidence {
  high: number;
  med: number;
  low: number;
  aggregate: number;
}

/** The markdown body of a `## <heading>` section, up to the next `## `. */
function extractSection(md: string, heading: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => new RegExp(String.raw`^##\s+${heading}\b`, "i").test(l));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i] ?? "")) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n");
}

/** Confidences from the schema-validated envelope's locatorTable, or []. */
function confidencesFromEnvelope(envelopePath: string | undefined): ("high" | "med" | "low")[] {
  if (!envelopePath || !existsSync(envelopePath)) return [];
  try {
    const env: unknown = JSON.parse(readFileSync(envelopePath, "utf8"));
    const rows = (env as { locatorTable?: { confidence?: string }[] }).locatorTable ?? [];
    return rows.map((r) => normaliseConfidence(String(r.confidence ?? "med")));
  } catch {
    return [];
  }
}

/** Column-aware fallback: parse the plan's locator-table section (identifies the
 * confidence CELL, not any `high` in prose) the same way the envelope is derived. */
function confidencesFromMarkdown(planMd: string): ("high" | "med" | "low")[] {
  try {
    return parseLocatorTable(extractSection(planMd, "Locator translation table")).map((r) => r.confidence);
  } catch {
    return [];
  }
}

/**
 * Plan confidence — the heaviest scorer input (0.40). Sourced from the
 * STRUCTURED confidence enum: the schema-validated envelope's
 * `locatorTable[].confidence` when present, else a column-aware parse of the
 * plan's locator table. NOT a prose scan: the old `/\bhigh\b/` first-match
 * counted the word "high" anywhere in a row (KB rationale, notes), and scored
 * plans using a non-high/med/low severity vocabulary as if they had no data —
 * a 40%-weight signal a Stage-1 model could inflate just by writing "high".
 */
export function planConfidence(planMd: string, envelopePath?: string): PlanConfidence {
  let confs = confidencesFromEnvelope(envelopePath);
  if (confs.length === 0) confs = confidencesFromMarkdown(planMd);
  let high = 0;
  let med = 0;
  let low = 0;
  for (const c of confs) {
    if (c === "high") high += 1;
    else if (c === "med") med += 1;
    else low += 1;
  }
  const total = high + med + low;
  if (total === 0) {
    return { high, med, low, aggregate: 0.5 };
  }
  // High=1.0, Med=0.6, Low=0.2 weighted average.
  const aggregate = (high * 1 + med * 0.6 + low * 0.2) / total;
  return { high, med, low, aggregate };
}

// ---- AST-diff-not-trivial heuristic.
// Conservative: count chars / lines / unique identifiers. If output diff is
// only whitespace + imports vs source, mark trivial. Real AST analysis is a
// v1 improvement; for v0 this catches the gross cases.
function isAstDiffTrivial(source: string, output: string): boolean {
  const stripImports = (s: string) =>
    s
      .split("\n")
      .filter((l) => !/^\s*(import|from|const\s+\w+\s+=\s+require)/.test(l))
      .join("\n");
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const normalize = (s: string) => stripComments(stripImports(s)).replace(/\s+/g, " ").trim();
  const a = normalize(source);
  const b = normalize(output);
  // If 80%+ of source bytes are present verbatim in output, mark trivial.
  const overlap = a.length === 0 ? 0 : longestCommonSubstring(a, b).length / a.length;
  return overlap > 0.8;
}

function longestCommonSubstring(a: string, b: string): string {
  // Naive O(nm) DP — fine for test files (<10KB each).
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return "";
  let maxLen = 0;
  let endIdx = 0;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    if (!row || !prevRow) continue;
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        const cell = (prevRow[j - 1] ?? 0) + 1;
        row[j] = cell;
        if (cell > maxLen) {
          maxLen = cell;
          endIdx = i;
        }
      }
    }
  }
  return a.slice(endIdx - maxLen, endIdx);
}

// ---- Report writer.
export interface Report {
  input: string;
  output: string;
  source: SmellCount;
  outputSmells: SmellCount;
  selector: SelectorMix;
  selectorQuality: number;
  webFirstRate: number;
  forbidden: string[];
  trivial: boolean;
  confidence: PlanConfidence;
  inputLoc: number;
  outputLoc: number;
  assertionFloor: AssertionFloorResult;
  domGrounded: boolean;
}

// Output quality signals (introduced 2026-06-04):
//   smellRemovalRate: fraction of source smells eliminated in output. 1.0 =
//     every source smell removed; 0.0 = none removed (or smells added).
//   forbiddenAbsence: 1.0 if no forbidden patterns in output, else 0.0.
// Previous formula was 0.6/0.3/0.1 over plan/selector/webfirst — output
// quality only impacted aggregate via selector + webfirst. High-quality
// Stage 2 work couldn't lift confidence above the plan's ceiling. New
// formula reduces plan weight to 0.4 and adds smell-removal + forbidden-
// absence so a clean migration of an ambitious plan reads above 0.7.
//
// Grounding cap (2026-06-22, docs/measured-quality-baseline.md Run 2): the
// selector-quality signal rewards canonical locators (getByRole/getByTestId)
// regardless of whether they were ever confirmed against the real DOM. A
// measured run showed this makes confidence ANTI-correlate with real quality —
// a HALLUCINATED `getByRole('alert')` scores as canonical but is more fragile
// than the honest CSS fallback it replaced, and the four highest-scored
// migrations all had ungrounded-locator defects a reviewer rejected. So when NO
// DOM-probe report confirms this migration's locators, the canonical credit is
// "claimed, not verified": cap the aggregate just below the verify-fire
// threshold (0.7, owned by migrate.yml / migrate-local) so an ungrounded
// migration is ROUTED TO VERIFY rather than auto-shipped on unverified guesses.
// A migration with a passing DOM probe keeps its full score and may auto-ship.
export const UNVERIFIED_LOCATOR_CONFIDENCE_CAP = 0.69;

export function computeAggregateConfidence(r: Report): number {
  const sourceSmellTotal = Object.values(r.source).reduce((a, b) => a + b, 0);
  const outputSmellTotal = Object.values(r.outputSmells).reduce((a, b) => a + b, 0);
  const smellRemovalRate = sourceSmellTotal === 0
    ? 1
    : Math.max(0, (sourceSmellTotal - outputSmellTotal) / sourceSmellTotal);
  const forbiddenAbsence = r.forbidden.length === 0 ? 1 : 0;
  const raw =
    r.confidence.aggregate * 0.4
    + r.selectorQuality * 0.25
    + r.webFirstRate * 0.1
    + smellRemovalRate * 0.15
    + forbiddenAbsence * 0.1;
  // Unverified canonical locators must not auto-ship — route to verify instead.
  if (!r.domGrounded) return Math.min(raw, UNVERIFIED_LOCATOR_CONFIDENCE_CAP);
  return raw;
}

function renderReport(r: Report): string {
  const deltaSmells: Record<string, number> = {};
  for (const k of Object.keys(r.source) as (keyof SmellCount)[]) {
    deltaSmells[k] = (r.outputSmells[k] ?? 0) - (r.source[k] ?? 0);
  }
  const smellTable = Object.entries(deltaSmells)
    .map(([k, v]) => `| ${k} | ${r.source[k as keyof SmellCount]} | ${r.outputSmells[k as keyof SmellCount]} | ${v >= 0 ? "+" : ""}${v} |`)
    .join("\n");
  const totalConfidence = computeAggregateConfidence(r).toFixed(2);
  return `# Migration report: ${basename(r.input)}

## Source → Target
- Source: \`${r.input}\` (${r.inputLoc} LOC)
- Output: \`${r.output}\` (${r.outputLoc} LOC)
- LOC delta: ${r.outputLoc - r.inputLoc >= 0 ? "+" : ""}${r.outputLoc - r.inputLoc}

## Quality scores
- **Aggregate confidence:** ${totalConfidence}
- Selector quality: ${(r.selectorQuality * 100).toFixed(0)}% (${r.selector.canonicalVerified} verified canonical / ${r.selector.canonicalUnverified} UNVERIFIED canonical / ${r.selector.fragile} fragile)
- Web-first assertion rate: ${(r.webFirstRate * 100).toFixed(0)}%
- **Assertion floor:** ${r.assertionFloor.emitted} emitted (floor ${r.assertionFloor.floor}) — ${r.assertionFloor.passed ? "✅ pass" : "❌ FAIL — emitted tree asserts nothing, REJECT"}
- **DOM grounding:** ${r.domGrounded ? "✅ locators DOM-confirmed" : "⚠️ UNVERIFIED — no passing DOM probe; canonical locators are unconfirmed guesses, so confidence is capped at 0.69 → routed to verify (set MIGRATION_TARGET_URL to ground them)"}
- Plan confidence: ${r.confidence.high} high / ${r.confidence.med} med / ${r.confidence.low} low → avg ${r.confidence.aggregate.toFixed(2)}

### Confidence breakdown
| Signal | Value | Weight | Contribution |
|---|---|---|---|
| Plan confidence | ${r.confidence.aggregate.toFixed(2)} | 0.40 | ${(r.confidence.aggregate * 0.4).toFixed(3)} |
| Selector quality | ${r.selectorQuality.toFixed(2)} | 0.25 | ${(r.selectorQuality * 0.25).toFixed(3)} |
| Web-first rate | ${r.webFirstRate.toFixed(2)} | 0.10 | ${(r.webFirstRate * 0.1).toFixed(3)} |
| Smell removal rate | ${(Object.values(r.source).reduce((a, b) => a + b, 0) === 0 ? 1 : Math.max(0, (Object.values(r.source).reduce((a, b) => a + b, 0) - Object.values(r.outputSmells).reduce((a, b) => a + b, 0)) / Object.values(r.source).reduce((a, b) => a + b, 0))).toFixed(2)} | 0.15 | — |
| Forbidden absence | ${r.forbidden.length === 0 ? "1.00" : "0.00"} | 0.10 | ${r.forbidden.length === 0 ? "0.100" : "0.000"} |

## Smell count (source → output → delta)
| Smell | Source | Output | Delta |
|---|---|---|---|
${smellTable}

## Forbidden patterns in output
${r.forbidden.length === 0 ? "✅ None." : r.forbidden.map((f) => `- ❌ \`${f}\``).join("\n")}

## AST diff
- **Trivial (cosmetic-only)?** ${r.trivial ? "❌ YES — REJECT THIS MIGRATION" : "✅ no"}

## Recommended human checks
1. Spot-check 2-3 LOW-confidence locator translations from the plan — do they match the real DOM?
2. Run the migrated test against staging; verify it catches the same bugs as the source did.
3. If verify report exists (\`outputs/reports/${basename(r.input)}-verify.md\`), read the disagreements section.
`;
}

// ---- Emitted-tree collection.
//
// The pwm-blueprint architecture moves every locator, count, assertion, and
// conditional OUT of the spec and into POM/block/fixture/api files under
// outputs/helper/. A scorer that reads only the spec sees an empty file and
// reports "100% canonical / no forbidden patterns / 0 assertions" even when a
// POM ships `.locator('.css')`, a flake-prone optional click, or all the real
// assertions — over-scoring confidence past the 0.7 verify gate. So the
// OUTPUT-quality signals must read the spec PLUS the helper files this migration
// actually uses.
//
// The hard part is that a spec does NOT import its page objects directly — it
// receives them by FIXTURE INJECTION: `async ({ loginPage, dashboardPage }) =>`.
// base.fixture.ts maps each fixture name to a `PageClass*` and imports that
// class from `@page-object/pages/<page>.page`. So we (1) read the fixtures the
// spec destructures, (2) resolve them through base.fixture to their real files,
// (3) follow those files' helper imports transitively (a page pulls a block +
// test-data), and (4) union in any file literally named `<spec-stem>.<layer>.ts`
// as a belt-and-suspenders fallback. We deliberately do NOT follow base.fixture's
// own imports wholesale — it is the barrel that imports EVERY page, which would
// score every accumulated migration's POM, not just this one's.

// Path aliases (from outputs/tsconfig.json) → subdir under outputs/helper/.
const HELPER_ALIAS_SUBDIRS: Record<string, string> = {
  "@fixtures/": "fixtures/",
  "@page-object/": "page-object/",
  "@api/": "api/",
  "@actions/": "actions/",
  "@browser/": "browser/",
  "@utilities/": "utilities/",
  "@test-data/": "test-data/",
  "@type-defs/": "types/",
};
// Playwright's own fixtures are not emitted helper files — skip them.
const PW_BUILTIN_FIXTURES = new Set([
  "page", "context", "request", "browser", "browserName", "contextOptions", "playwright", "baseURL",
]);

/** Resolve a `@alias/...` import specifier to an absolute helper .ts path, or
 * null when it is not a helper alias (e.g. `@playwright/test`, a relative path). */
function resolveAliasImport(spec: string, helperRoot: string): string | null {
  if (spec === "@logger") return join(helperRoot, "utilities", "logger.ts");
  for (const [prefix, sub] of Object.entries(HELPER_ALIAS_SUBDIRS)) {
    if (spec.startsWith(prefix)) return join(helperRoot, sub + spec.slice(prefix.length) + ".ts");
  }
  return null;
}

/** Every `from "..."` / `import "..."` specifier in a source file. */
function extractImportSpecifiers(src: string): string[] {
  const specs: string[] = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s+["']([^"']+)["']/g]) {
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      if (m[1] !== undefined) specs.push(m[1]);
    }
  }
  return specs;
}

/** Fixture names the spec destructures from its test callbacks (minus Playwright
 * built-ins) — the page objects this migration actually exercises. */
function extractUsedFixtures(specSrc: string): Set<string> {
  const used = new Set<string>();
  const re = /async\s*\(\s*\{([^}]*)\}/g;
  for (let m = re.exec(specSrc); m !== null; m = re.exec(specSrc)) {
    for (const raw of (m[1] ?? "").split(",")) {
      const name = (raw.split(":")[0] ?? "").replace(/\./g, "").trim();
      if (name !== "" && /^[A-Za-z_]\w*$/.test(name) && !PW_BUILTIN_FIXTURES.has(name)) used.add(name);
    }
  }
  return used;
}

/** Map each fixture name declared in base.fixture to the helper file backing it,
 * by joining `<fixture>: async (...) => new <Class>(...)` to the import of
 * `<Class>`. */
function mapFixturesToFiles(fxSrc: string, helperRoot: string): Map<string, string> {
  const classToFile = new Map<string, string>();
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
  for (let m = importRe.exec(fxSrc); m !== null; m = importRe.exec(fxSrc)) {
    const file = resolveAliasImport(m[2] ?? "", helperRoot);
    if (file === null) continue;
    for (const raw of (m[1] ?? "").split(",")) {
      const token = raw.trim().replace(/^type\s+/, "");
      if (token === "") continue;
      const local = token.includes(" as ") ? (token.split(" as ")[1] ?? token).trim() : token;
      classToFile.set(local, file);
    }
  }
  const fixtureToFile = new Map<string, string>();
  const fxRe = /(\w+)\s*:\s*async\b[\s\S]*?\bnew\s+(\w+)\s*\(/g;
  for (let m = fxRe.exec(fxSrc); m !== null; m = fxRe.exec(fxSrc)) {
    const file = m[2] === undefined ? undefined : classToFile.get(m[2]);
    if (m[1] !== undefined && file !== undefined) fixtureToFile.set(m[1], file);
  }
  return fixtureToFile;
}

/** Pop each worklist file, record its PATH, and enqueue its helper imports —
 * the transitive close over `@alias` imports, never crossing back into the
 * base.fixture barrel. Mutates `files` and `seen`. */
function followHelperImportFiles(
  worklist: string[], helperRoot: string, baseFixturePath: string, files: string[], seen: Set<string>,
): void {
  while (worklist.length > 0) {
    const file = worklist.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) continue;
    files.push(file);
    for (const spec of extractImportSpecifiers(readFileSync(file, "utf8"))) {
      const f = resolveAliasImport(spec, helperRoot);
      if (f !== null && f !== baseFixturePath && !seen.has(f)) worklist.push(f);
    }
  }
}

/**
 * The FILE PATHS that make up a migration's emitted tree: the spec plus every
 * POM / block / helper it reaches by fixture injection and `@alias` import
 * (pwm-blueprint hides every locator in these files, not the spec). This is the
 * same resolution `collectEmittedSources` uses to score the tree — exposed as
 * paths so the live DOM probe (dom-ground.ts --probe-tree) can probe the SAME
 * files the scorer credits. Without this the probe saw a spec with zero
 * locators, so `domGrounded` was permanently false and the 0.69 unverified cap
 * could never lift even with a live SUT.
 */
export function collectEmittedFiles(specPath: string, helperRootOverride?: string): string[] {
  const files = [specPath];
  const helperRoot = helperRootOverride
    ?? join(resolve(new URL("..", import.meta.url).pathname), "outputs", "helper");
  if (!existsSync(helperRoot)) return files;

  const specSrc = readFileSync(specPath, "utf8");
  const seen = new Set<string>();
  const worklist: string[] = [];
  const baseFixturePath = join(helperRoot, "fixtures", "base.fixture.ts");

  // (1) Fixture-injected page objects, resolved through base.fixture.
  if (existsSync(baseFixturePath)) {
    const fixtureToFile = mapFixturesToFiles(readFileSync(baseFixturePath, "utf8"), helperRoot);
    for (const fx of extractUsedFixtures(specSrc)) {
      const f = fixtureToFile.get(fx);
      if (f !== undefined) worklist.push(f);
    }
  }
  // (2) The spec's own direct helper imports (test-data, utilities, types …),
  // excluding the base.fixture barrel itself.
  for (const spec of extractImportSpecifiers(specSrc)) {
    const f = resolveAliasImport(spec, helperRoot);
    if (f !== null && f !== baseFixturePath) worklist.push(f);
  }
  // (3) Transitively follow those files' helper imports.
  followHelperImportFiles(worklist, helperRoot, baseFixturePath, files, seen);

  // (4) Union fallback: any file literally named `<spec-stem>.<layer>.ts`.
  addStemFallbackFiles(helperRoot, basename(specPath).replace(/\.spec\.ts$/i, ""), files, seen);

  return files;
}

/** Append any `<specStem>.<layer>.ts` under helperRoot not already collected. */
function addStemFallbackFiles(helperRoot: string, specStem: string, files: string[], seen: Set<string>): void {
  const stack = [helperRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_legacy-v0.1.x") stack.push(full);
      } else if (entry.name.endsWith(".ts") && entry.name.startsWith(`${specStem}.`) && !seen.has(full)) {
        seen.add(full);
        files.push(full);
      }
    }
  }
}

/** Method names invoked on the spec's fixture-injected page objects (e.g.
 * `loginPage.signIn(...)` → "signIn"). The migration's REACHABLE method surface. */
export function extractCalledMethods(specSrc: string, fixtureVars: Set<string>): Set<string> {
  const called = new Set<string>();
  for (const fx of fixtureVars) {
    const re = new RegExp(String.raw`\b${fx}\s*\.\s*(\w+)\s*\(`, "g");
    for (let m = re.exec(specSrc); m !== null; m = re.exec(specSrc)) {
      if (m[1] !== undefined) called.add(m[1]);
    }
  }
  return called;
}

const LIFECYCLE_METHODS = new Set(["open", "waitForPageLoad", "constructor"]);

/** Strip line/block comments + string & regex literal CONTENTS so brace counting
 * is not fooled by a `{` inside a string. Preserves line count + brace structure. */
function sanitizeForBraces(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/\/(?:[^/\\\n]|\\.)+\/[a-z]*/g, "/RE/");
}

/**
 * Keep a POM class's locator FIELDS plus only the methods THIS migration reaches
 * (called methods + lifecycle), dropping methods inherited from OTHER migrations
 * that share the file. Without this, a shared POM that accumulates methods over
 * time credits/penalises every migration for code it never runs, so scores drift
 * toward 1.0 and stop discriminating (audit: scorer-scores-whole-shared-pom).
 */
/** Index of the line where the brace block opened at/after `start` closes. */
function blockEndLine(lines: string[], start: number): number {
  let depth = 0;
  let started = false;
  for (let j = start; j < lines.length; j++) {
    for (const ch of sanitizeForBraces(lines[j] ?? "")) {
      if (ch === "{") { depth += 1; started = true; }
      else if (ch === "}") depth -= 1;
    }
    if (started && depth <= 0) return j;
  }
  return lines.length - 1;
}

const POM_METHOD_RE = /^\s{2,}(?:public |private |protected |static |async )*([A-Za-z_]\w*)\s*\([^)]*\)\s*(?::[^={]+)?\{/;

export function sliceReachablePom(pomSrc: string, called: Set<string>): string {
  const lines = pomSrc.split("\n");
  const keep: boolean[] = new Array(lines.length).fill(true);
  let i = 0;
  while (i < lines.length) {
    const name = POM_METHOD_RE.exec(lines[i] ?? "")?.[1];
    if (name !== undefined && !called.has(name) && !LIFECYCLE_METHODS.has(name)) {
      const end = blockEndLine(lines, i);
      for (let j = i; j <= end; j++) keep[j] = false;
      i = end + 1;
    } else {
      i += 1;
    }
  }
  return lines.filter((_, idx) => keep[idx]).join("\n");
}

/**
 * The concatenated SOURCE of a migration's emitted tree (spec + reachable
 * POMs/helpers). Default ("whole") reads every file verbatim — the current,
 * baseline-anchored behaviour. PWM_SCORE_SCOPE=reachable slices each fixture-
 * reached POM/block down to THIS migration's method surface (opt-in; flipping
 * the default is a deliberate re-baseline against the acceptance label corpus).
 */
export function collectEmittedSources(specPath: string, helperRootOverride?: string): string {
  const files = collectEmittedFiles(specPath, helperRootOverride).filter((f) => existsSync(f));
  if (process.env["PWM_SCORE_SCOPE"] !== "reachable") {
    return files.map((f) => readFileSync(f, "utf8")).join("\n");
  }
  const specSrc = readFileSync(specPath, "utf8");
  const called = extractCalledMethods(specSrc, extractUsedFixtures(specSrc));
  return files
    .map((f) => {
      const src = readFileSync(f, "utf8");
      return f !== specPath && /\.(page|block)\.ts$/.test(f) ? sliceReachablePom(src, called) : src;
    })
    .join("\n");
}

/** Is this migration's locator set CONFIRMED against the real DOM? True only when
 * a DOM-probe report exists next to the metrics report, resolved real locators,
 * and found NO `not-found` (hallucinated) locator. A probe with not-found > 0 —
 * a locator the DOM doesn't have — does NOT count as grounded. */
export function domProbeConfirmed(reportOutPath: string): boolean {
  const probePath = reportOutPath.replace(/\.md$/i, "-dom-probe.json");
  if (!existsSync(probePath)) return false;
  try {
    const r = JSON.parse(readFileSync(probePath, "utf8")) as Record<string, unknown>;
    const num = (k: string): number => {
      const v = r[k];
      return typeof v === "number" ? v : 0;
    };
    return num("totalLocators") > 0 && num("resolvedUnique") > 0 && num("notFound") === 0;
  } catch {
    return false;
  }
}

// ---- Main.
function main(): void {
  const args = parseCliArgs();
  // Explicit file-existence guards with workflow-friendly error annotations.
  // Raw readFileSync ENOENT messages are cryptic; this gives reviewers a
  // clear pointer to the missing file.
  for (const [name, path] of Object.entries({
    input: args.input,
    output: args.output,
    plan: args.plan,
  })) {
    try {
      readFileSync(path, "utf8");
    } catch {
      process.stderr.write(`::error::evaluate: --${name} not found at ${path}\n`);
      process.exit(1);
    }
  }
  const inputSrc = readFileSync(args.input, "utf8");
  const outputSrc = readFileSync(args.output, "utf8");
  const planMd = readFileSync(args.plan, "utf8");
  // OUTPUT-quality signals score the WHOLE emitted tree (spec + the POM/block/
  // helper files it imports), not the bare spec — pwm-blueprint hides locators,
  // smells, and forbidden patterns in helpers. LOC/AST-diff stay spec-scoped.
  const emittedSrc = collectEmittedSources(args.output);

  const sourceSmells = countSmells(inputSrc);
  const outputSmells = countSmells(emittedSrc);
  const selector = selectorMix(emittedSrc);
  const selectorQuality = selectorQualityScore(selector);
  const webFirstRate = webFirstAssertionRate(emittedSrc);
  const forbidden = findForbidden(emittedSrc);
  const trivial = isAstDiffTrivial(inputSrc, outputSrc);
  // Prefer the schema-validated envelope's structured confidence (derived from
  // the plan path, the convention derive-envelope.ts / migrate.yml use).
  const confidence = planConfidence(planMd, args.plan.replace(/\.md$/i, ".envelope.json"));
  const inputLoc = inputSrc.split("\n").length;
  const outputLoc = outputSrc.split("\n").length;
  const assertionFloor = checkAssertionFloor(countAssertions(emittedSrc));
  const domGrounded = domProbeConfirmed(args["report-out"]);

  const report: Report = {
    input: args.input,
    output: args.output,
    source: sourceSmells,
    outputSmells,
    selector,
    selectorQuality,
    webFirstRate,
    forbidden,
    trivial,
    confidence,
    inputLoc,
    outputLoc,
    assertionFloor,
    domGrounded,
  };

  mkdirSync(dirname(args["report-out"]), { recursive: true });
  writeFileSync(args["report-out"], renderReport(report));

  // Hard gate: a migration that asserts nothing is a silent no-op — reject it.
  // The report is written FIRST (above) so a reviewer sees the failing scorecard.
  if (!assertionFloor.passed) {
    process.stderr.write(
      `::error::evaluate: emitted tree has ${assertionFloor.emitted} assertion(s); `
      + `floor is ${assertionFloor.floor}. A test that asserts nothing passes `
      + `silently — REJECT.\n`,
    );
    process.exit(1);
  }

  // Persist metrics to SQLite for cross-run trend analysis (v1 ROADMAP
  // "Metrics dashboard"). Wrapped in try/catch — the metrics DB is a local
  // reporting cache, not a system of record, so a write failure must not
  // fail the migration workflow. See scripts/metrics.ts for schema.
  try {
    const sourceFramework = parseSourceFrameworkFromPlan(planMd);
    const subtractive = sourceFramework === "bad-playwright";
    const sourceSmellTotal = Object.values(report.source).reduce((a, b) => a + b, 0);
    const outputSmellTotal = Object.values(report.outputSmells).reduce((a, b) => a + b, 0);
    const smellRemovalRate = sourceSmellTotal === 0
      ? 1
      : Math.max(0, (sourceSmellTotal - outputSmellTotal) / sourceSmellTotal);
    const forbiddenAbsence = report.forbidden.length === 0 ? 1 : 0;
    const dbPath = process.env["METRICS_DB"] ?? "outputs/.metrics.db";
    const commitSha = process.env["GITHUB_SHA"] ?? "local";
    const usage = loadUsageStats(args.usage);
    const metricsDB = new MetricsDB(dbPath);
    try {
      metricsDB.recordMigration({
        input_basename: basename(args.input),
        source_framework: sourceFramework,
        subtractive,
        aggregate_confidence: computeAggregateConfidence(report),
        selector_quality_score: report.selectorQuality,
        web_first_rate: report.webFirstRate,
        plan_confidence_aggregate: report.confidence.aggregate,
        smell_removal_rate: smellRemovalRate,
        forbidden_absence: forbiddenAbsence,
        commit_sha: commitSha,
        usage,
      });
    } finally {
      metricsDB.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`::warning::evaluate: metrics persistence failed (non-fatal): ${msg}\n`);
  }

  // Aggregate confidence to stdout — workflow consumes this. Uses the same
  // formula as the rendered report (computeAggregateConfidence) so the
  // workflow-routed value cannot drift from the human-readable report.
  process.stdout.write(computeAggregateConfidence(report).toFixed(2));
}

/**
 * Parse the source framework label from a plan markdown body. Mirrors
 * scripts/derive-envelope.ts:parseSourceFramework — kept local to avoid
 * importing from a script that itself imports ts-morph (heavy dep on a
 * lightweight metrics write).
 */
function parseSourceFrameworkFromPlan(planMd: string): string {
  const lowered = planMd.toLowerCase();
  if (lowered.includes("bad-playwright")) return "bad-playwright";
  if (lowered.includes("selenium-java") || lowered.includes("selenium java")) return "selenium-java";
  if (lowered.includes("selenium-python") || lowered.includes("selenium python")) return "selenium-python";
  if (lowered.includes("cypress")) return "cypress";
  return "unknown";
}

// Only run the scorer when invoked directly — importing for tests must not run.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
