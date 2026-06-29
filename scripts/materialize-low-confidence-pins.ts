#!/usr/bin/env tsx
/**
 * materialize-low-confidence-pins.ts — close the ROADMAP v1.0 partial item
 * "LOW-confidence pin rules" by lifting the DOM-probe report's LOW verdicts
 * out of the report JSON and INTO the generated source files.
 *
 * Why this exists
 * ---------------
 * `scripts/dom-ground.ts` already annotates each probed locator with a
 * `claimedConfidence` (what Stage 2 said) and a `demotedTo` (what the live
 * DOM verdict was). LOW pins — either claimed-low by the LLM or demoted-low
 * by the probe (zero matches) — are the locators most likely to flake or be
 * wrong. Today the verdict lives only in `outputs/reports/<basename>-dom-probe.json`;
 * a human reviewer must alt-tab between the report and the spec to know
 * which line is suspect.
 *
 * This script materialises the verdict at the call site: it walks every
 * `<basename>.spec.ts` + helper page-object referenced by the report, finds
 * the exact source line carrying a LOW pin, and either
 *   (a) inserts a ` // WHY: dom-ground LOW confidence — <evidence>` comment
 *       above the locator (default — comment-only), OR
 *   (b) auto-rewrites the locator using a fallback dictionary AND inserts
 *       the WHY-comment (when a fallback rule matches).
 *
 * Fallback dictionary semantics
 * -----------------------------
 * Each entry in `FALLBACK_RULES` carries:
 *   - `name`         — short id for logs / dry-run output
 *   - `description`  — when it kicks in, why it's safe
 *   - `match(src)`   — pure check on the locator's source string; return
 *                      a `RewriteHint` if applicable, `null` otherwise.
 *   - `replacement`  — the safer locator string to emit in place of the old.
 *   - `note`         — extra explainer appended to the WHY-comment so the
 *                      reviewer knows WHY the script rewrote it.
 *
 * Rules are matched in declaration order; the first match wins. Add new rules
 * by appending to the array — never reorder existing entries (the dry-run
 * output is observed by humans and reorder would silently change behaviour).
 *
 * Idempotency guarantee
 * ---------------------
 * Re-running on already-materialised code is a no-op. We detect the marker
 * comment `// WHY: dom-ground LOW confidence` immediately above the target
 * line; if present, the line is treated as already materialised and skipped
 * (both for comment-only AND for auto-rewrite — once rewritten, the locator
 * text no longer matches the probe-report `locator` field, so re-running the
 * dom-ground step would either drop the row or re-classify it on its own).
 *
 * CLI
 * ---
 *   npx tsx scripts/materialize-low-confidence-pins.ts \
 *     --basename <input_basename> \
 *     [--dry-run]
 *
 * Exit codes
 * ----------
 *   0 — success (including the "no report exists" silent-skip path and the
 *       "no LOW pins" path; dry-run also exits 0)
 *   1 — parse error reading the probe report, or unrecoverable AST failure
 *
 * If `outputs/reports/<basename>-dom-probe.json` does not exist the script
 * exits 0 with a notice on stdout — the DOM grounding step is opt-in (gated
 * by `MIGRATION_TARGET_URL`) and we don't want this to become a blocker on
 * runs without a live SUT.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Project, SyntaxKind, type CallExpression, type Node, type SourceFile } from "ts-morph";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const MARKER = "// WHY: dom-ground LOW confidence";

// ---------------------------------------------------------------------------
// Probe report shape — kept in sync with scripts/dom-ground.ts. If that
// script changes, mirror the change here (no shared types module yet; per
// repo convention we keep validators self-contained).
// ---------------------------------------------------------------------------

type DomVerdict = "resolved-unique" | "resolved-multiple" | "not-found" | "skipped";

interface ProbedLocator {
  locator: string;
  file: string;
  line: number;
  claimedConfidence: "high" | "med" | "low" | "unknown";
  domVerdict: DomVerdict;
  domEvidence: string;
  matches: number;
  demotedTo: "med" | "low" | null;
}

interface ProbeReport {
  timestamp: string;
  url: string;
  mode: "live" | "mock";
  totalLocators: number;
  resolvedUnique: number;
  resolvedMultiple: number;
  notFound: number;
  skipped: number;
  results: ProbedLocator[];
}

// ---------------------------------------------------------------------------
// Fallback dictionary
// ---------------------------------------------------------------------------

interface RewriteHint {
  /** The safer locator source string to emit in place of the LOW pin. */
  replacement: string;
  /** Short note appended to the WHY-comment so the reviewer sees the rationale. */
  note: string;
}

interface FallbackRule {
  name: string;
  description: string;
  match: (locatorSrc: string) => RewriteHint | null;
}

/**
 * RULE 1 — getByText("<button label>") for known interactive labels →
 *          getByRole("button", { name: "<label>" }).
 *
 * Kicks in when:
 *   - The locator is `page.getByText("<text>")` (single string literal arg),
 *     AND
 *   - The text matches a SHORT verb-phrase common on submit buttons
 *     (Submit / Save / Cancel / Continue / Sign in / Log in / OK / Close /
 *     Confirm / Next / Back). The heuristic is intentionally conservative —
 *     we only rewrite when the text reads unambiguously like a button label;
 *     longer or sentence-cased text falls through to comment-only.
 *
 * Why safe:
 *   - getByRole is more specific than getByText (filters to <button> /
 *     [role=button] elements) so an ambiguous text match on the page
 *     (e.g., the word "Submit" appearing in body copy AND on the button)
 *     becomes unambiguous.
 *   - The pwm-blueprint architecture prefers role-based selectors (KB
 *     pwm-blueprint/selector-priority/role-over-text).
 */
const BUTTON_LABELS_RE =
  /^(?:Submit|Save|Cancel|Continue|Sign in|Sign In|Log in|Log In|OK|Ok|Close|Confirm|Next|Back|Delete|Remove|Add|Edit|Update|Send)$/;

const ruleButtonText: FallbackRule = {
  name: "getByText-button-to-getByRole",
  description:
    "Rewrite getByText('<button label>') to getByRole('button', { name: '<label>' }) when the text reads like an interactive button label.",
  match(src) {
    // Capture: receiver chain (page / this.page / etc) before getByText, AND the literal arg.
    const m = /^(.*\b)getByText\(\s*(['"])([^'"]+)\2\s*\)$/.exec(src);
    if (!m) return null;
    const [, receiver, , label] = m;
    if (!receiver || !label) return null;
    if (!BUTTON_LABELS_RE.test(label)) return null;
    return {
      replacement: `${receiver}getByRole("button", { name: "${label}" })`,
      note: `auto-fallback: text "${label}" reads as a button label, promoted to role-based selector`,
    };
  },
};

/**
 * RULE 2 — getByText(/regex/) with no `exact: true` and the regex is bare
 *          word-token → comment-only.
 *
 * Kicks in when:
 *   - Locator is `page.getByText(/word/)` or similar single-token regex.
 *
 * Why comment-only (NOT rewritten):
 *   - Without DOM context we can't safely guess the right role. A bare
 *     `/Welcome/` could be a heading, link, or paragraph copy; rewriting
 *     blindly to `getByRole("heading", …)` would be a regression.
 *   - The WHY-comment surfaces the ambiguity to the reviewer so they can
 *     pick the right role manually.
 */
const ruleAmbiguousTextRegex: FallbackRule = {
  name: "getByText-regex-comment-only",
  description:
    "Flag getByText(/regex/) as ambiguous via WHY-comment — no auto-rewrite, the reviewer picks the right role.",
  match(src) {
    const m = /^.*\bgetByText\(\s*\/[^/]+\/[gimsuy]*\s*\)$/.exec(src);
    if (!m) return null;
    return {
      // Comment-only: replacement === original source (signals no rewrite).
      replacement: src,
      note: "auto-fallback: regex text match is ambiguous — pick the right role manually",
    };
  },
};

/**
 * RULE 3 — `page.locator("<css-class-only>")` → comment-only.
 *
 * Kicks in when:
 *   - Locator is `page.locator(".foo")` or `page.locator(".foo .bar")` —
 *     pure CSS class chain, no role / data-testid / aria.
 *
 * Why comment-only (NOT rewritten):
 *   - CSS classes are the most-fragile selector strategy (KB
 *     pwm-blueprint/selector-priority/no-css-class). Auto-rewriting requires
 *     knowing what the element ACTUALLY is in the DOM — that information
 *     lives in the probe but isn't structured enough for a safe automated
 *     swap. Surface the LOW verdict and let the reviewer pick a stable
 *     selector (data-testid / role / label).
 */
const ruleCssClassLocator: FallbackRule = {
  name: "locator-css-class-comment-only",
  description:
    "Flag page.locator('.css-class') as fragile via WHY-comment — no auto-rewrite; reviewer picks stable selector.",
  match(src) {
    const m = /^.*\blocator\(\s*(['"])(\.[A-Za-z][\w-]*(?:\s+\.[A-Za-z][\w-]*)*)\1\s*\)$/.exec(src);
    if (!m) return null;
    return {
      replacement: src,
      note: "auto-fallback: CSS class selector is fragile — prefer getByTestId / getByRole / getByLabel",
    };
  },
};

const FALLBACK_RULES: readonly FallbackRule[] = [
  ruleButtonText,
  ruleAmbiguousTextRegex,
  ruleCssClassLocator,
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  basename: string;
  dryRun: boolean;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      basename: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.basename) {
    process.stderr.write(
      "Usage: materialize-low-confidence-pins --basename <input_basename> [--dry-run]\n",
    );
    process.exit(1);
  }
  return { basename: values.basename, dryRun: values["dry-run"] === true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from a CallExpression to its containing statement so leading
 * comments + line-start indentation resolve from the statement boundary.
 * Falls back to the call itself for unusual nestings (call inside an array
 * literal, etc) so we still emit SOMETHING rather than crashing.
 */
function containingStatement(call: CallExpression): Node {
  // ExpressionStatement covers `await page.getByX(...);`.
  // VariableStatement covers `const x = page.getByX(...);`.
  // We pick the first ancestor of either kind.
  const exprStmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  if (exprStmt !== undefined) return exprStmt;
  const varStmt = call.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  if (varStmt !== undefined) return varStmt;
  return call;
}

function isLowPin(p: ProbedLocator): boolean {
  // Either the LLM declared LOW, or the DOM probe demoted it to LOW (zero
  // matches in the live DOM). Either signal is enough — both should be
  // surfaced to the reviewer.
  return p.claimedConfidence === "low" || p.demotedTo === "low";
}

function matchFallback(locatorSrc: string): { rule: FallbackRule; hint: RewriteHint } | null {
  for (const rule of FALLBACK_RULES) {
    const hint = rule.match(locatorSrc);
    if (hint !== null) return { rule, hint };
  }
  return null;
}

function readProbeReport(reportPath: string): ProbeReport {
  const raw = readFileSync(reportPath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Probe report at ${reportPath} is not a JSON object`);
  }
  const report = parsed as Partial<ProbeReport>;
  if (!Array.isArray(report.results)) {
    throw new Error(`Probe report at ${reportPath} missing 'results' array`);
  }
  return report as ProbeReport;
}

/**
 * Find the locator-call CallExpression on the line the probe reported.
 * The probe records the 1-based line of the receiver call (`page.getByX(...)`).
 * We re-walk the AST so we can do source-text comparison instead of relying
 * on raw line-based regex (which would mis-fire on multi-line locator chains).
 */
function findLocatorCallOnLine(
  sourceFile: SourceFile,
  line: number,
  expectedLocatorText: string,
): CallExpression | null {
  let found: CallExpression | null = null;
  sourceFile.forEachDescendant((node) => {
    if (found !== null) return;
    if (!node.isKind(SyntaxKind.CallExpression)) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    const { line: callLine } = sourceFile.getLineAndColumnAtPos(call.getStart());
    if (callLine !== line) return;
    const firstLine = call.getText().split("\n")[0]?.trim() ?? call.getText();
    if (firstLine === expectedLocatorText) {
      found = call;
    }
  });
  return found;
}

interface Transform {
  filePath: string;
  line: number;
  locator: string;
  evidence: string;
  /** Null when the action is "comment-only". */
  rewriteTo: string | null;
  ruleName: string | null;
  note: string | null;
}

interface PlannedAction {
  filePath: string;
  pins: ProbedLocator[];
}

function groupByFile(pins: ProbedLocator[]): PlannedAction[] {
  const byFile = new Map<string, ProbedLocator[]>();
  for (const pin of pins) {
    const existing = byFile.get(pin.file);
    if (existing) {
      existing.push(pin);
    } else {
      byFile.set(pin.file, [pin]);
    }
  }
  return [...byFile.entries()].map(([filePath, fp]) => ({ filePath, pins: fp }));
}

interface FileResult {
  filePath: string;
  transforms: Transform[];
  skipped: { line: number; reason: string }[];
}

/**
 * Process ONE source file: load with ts-morph, locate each LOW pin's
 * CallExpression, decide comment-only vs rewrite, and (when not dry-run)
 * apply the edits. The edits are applied lowest-to-highest line index so
 * earlier insertions don't shift later line numbers.
 */
function processFile(
  filePath: string,
  pins: ProbedLocator[],
  dryRun: boolean,
): FileResult {
  const abs = resolve(REPO_ROOT, filePath);
  const result: FileResult = { filePath, transforms: [], skipped: [] };
  if (!existsSync(abs)) {
    result.skipped.push({ line: 0, reason: `source file does not exist: ${abs}` });
    return result;
  }
  const src = readFileSync(abs, "utf-8");
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  const sourceFile = project.createSourceFile(abs, src, { overwrite: true });

  // Plan all transforms first — capture text + offsets up front so the
  // subsequent string-level edits don't invalidate ts-morph node handles.
  // (ts-morph forgets all nodes on the first mutation; pre-computing offsets
  // avoids the "node was removed or forgotten" failure mode.)
  const plan: { transform: Transform; callStart: number; callEnd: number; stmtLineStart: number }[] = [];

  for (const pin of pins) {
    const call = findLocatorCallOnLine(sourceFile, pin.line, pin.locator);
    if (call === null) {
      result.skipped.push({
        line: pin.line,
        reason: `could not locate '${pin.locator}' on line ${pin.line} (file likely edited since probe)`,
      });
      continue;
    }
    // Idempotency check — the marker comment lives above the containing
    // statement (the `await page.getByX(...)` line). Walk up to the
    // ExpressionStatement so leading comments are read from the statement
    // boundary, not from the bare CallExpression (which has no leading
    // trivia of its own when wrapped in `await x.y(...)`).
    const stmt = containingStatement(call);
    const leading = stmt.getLeadingCommentRanges();
    const alreadyMarked = leading.some((r) => r.getText().includes(MARKER));
    if (alreadyMarked) {
      result.skipped.push({
        line: pin.line,
        reason: `already materialised (WHY-comment present)`,
      });
      continue;
    }
    const fallback = matchFallback(pin.locator);
    const rewriteTo = fallback !== null && fallback.hint.replacement !== pin.locator
      ? fallback.hint.replacement
      : null;
    const transform: Transform = {
      filePath: pin.file,
      line: pin.line,
      locator: pin.locator,
      evidence: pin.domEvidence,
      rewriteTo,
      ruleName: fallback?.rule.name ?? null,
      note: fallback?.hint.note ?? null,
    };
    // Capture offsets eagerly — the AST will be discarded after this loop.
    const fullText = sourceFile.getFullText();
    const stmtStart = stmt.getStart();
    let lineStart = stmtStart;
    while (lineStart > 0 && fullText[lineStart - 1] !== "\n") lineStart -= 1;
    plan.push({
      transform,
      callStart: call.getStart(),
      callEnd: call.getEnd(),
      stmtLineStart: lineStart,
    });
    result.transforms.push(transform);
  }

  if (dryRun || plan.length === 0) return result;

  // Apply edits as pure string slicing on the source text, sorted descending
  // by stmtLineStart so the comment insertion above an earlier statement
  // doesn't shift offsets for later (in-file-position) statements. Within a
  // single planned edit we (a) replace the call slice, (b) insert the
  // WHY-comment line above stmtLineStart.
  plan.sort((a, b) => b.stmtLineStart - a.stmtLineStart);
  let text = sourceFile.getFullText();
  for (const entry of plan) {
    text = applyPlannedEdit(text, entry);
  }
  writeFileSync(abs, text, "utf-8");
  return result;
}

function applyPlannedEdit(
  text: string,
  entry: { transform: Transform; callStart: number; callEnd: number; stmtLineStart: number },
): string {
  let next = text;
  // 1. Rewrite the locator slice (if any). Do this before the comment
  //    insertion so the comment insert's offset is still valid.
  if (entry.transform.rewriteTo !== null) {
    next = next.slice(0, entry.callStart) + entry.transform.rewriteTo + next.slice(entry.callEnd);
  }
  // 2. Build + prepend the WHY-comment line, preserving the statement's
  //    leading indentation so it visually aligns with the line below.
  const indent = next.slice(entry.stmtLineStart, sniffIndentEnd(next, entry.stmtLineStart));
  const noteSuffix = entry.transform.note !== null ? ` (${entry.transform.note})` : "";
  const comment = `${MARKER} — ${entry.transform.evidence}${noteSuffix}`;
  next = next.slice(0, entry.stmtLineStart) + `${indent}${comment}\n` + next.slice(entry.stmtLineStart);
  return next;
}

/** Returns the offset of the first non-whitespace character at or after `from`. */
function sniffIndentEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  return i;
}

// ---------------------------------------------------------------------------
// Resolve which source files the report refers to
// ---------------------------------------------------------------------------

function collectFilesFromReport(report: ProbeReport): string[] {
  const files = new Set<string>();
  for (const r of report.results) {
    if (isLowPin(r)) files.add(r.file);
  }
  return [...files];
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function summarize(results: FileResult[], dryRun: boolean): void {
  const totalTransforms = results.reduce((acc, r) => acc + r.transforms.length, 0);
  const totalRewrites = results.reduce(
    (acc, r) => acc + r.transforms.filter((t) => t.rewriteTo !== null).length,
    0,
  );
  const totalComments = totalTransforms - totalRewrites;
  const totalSkipped = results.reduce((acc, r) => acc + r.skipped.length, 0);

  const prefix = dryRun ? "[dry-run] " : "";
  process.stdout.write(
    `${prefix}materialize-low-confidence-pins: ${totalTransforms} transform(s) planned across ${results.length} file(s)\n`,
  );
  process.stdout.write(`${prefix}  comment-only:  ${totalComments}\n`);
  process.stdout.write(`${prefix}  auto-rewrite:  ${totalRewrites}\n`);
  process.stdout.write(`${prefix}  skipped:       ${totalSkipped}\n`);

  for (const result of results) {
    if (result.transforms.length === 0 && result.skipped.length === 0) continue;
    process.stdout.write(`\n${prefix}${result.filePath}\n`);
    for (const t of result.transforms) {
      const kind = t.rewriteTo !== null ? `REWRITE [${t.ruleName ?? "unnamed"}]` : "COMMENT  ";
      process.stdout.write(`${prefix}  line ${t.line.toString().padStart(4)}  ${kind}  ${t.locator}\n`);
      if (t.rewriteTo !== null) {
        process.stdout.write(`${prefix}                       ↳ ${t.rewriteTo}\n`);
      }
      process.stdout.write(`${prefix}                       WHY: ${t.evidence}\n`);
    }
    for (const s of result.skipped) {
      process.stdout.write(`${prefix}  line ${s.line.toString().padStart(4)}  SKIP      ${s.reason}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseCliArgs();
  const reportPath = resolve(REPO_ROOT, "outputs", "reports", `${args.basename}-dom-probe.json`);

  if (!existsSync(reportPath)) {
    process.stdout.write(
      `materialize-low-confidence-pins: no probe report at ${reportPath} — DOM grounding is optional, skipping (exit 0).\n`,
    );
    process.exit(0);
  }

  let report: ProbeReport;
  try {
    report = readProbeReport(reportPath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`::error::materialize-low-confidence-pins: failed to parse ${reportPath} — ${msg}\n`);
    process.exit(1);
  }

  const lowPins = report.results.filter(isLowPin);
  if (lowPins.length === 0) {
    process.stdout.write(
      `materialize-low-confidence-pins: 0 LOW pins in ${reportPath} — nothing to materialise (exit 0).\n`,
    );
    process.exit(0);
  }

  const files = collectFilesFromReport(report);
  const grouped = groupByFile(lowPins).filter((g) => files.includes(g.filePath));

  const results: FileResult[] = [];
  for (const group of grouped) {
    try {
      results.push(processFile(group.filePath, group.pins, args.dryRun));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`::error::materialize-low-confidence-pins: AST failure on ${group.filePath} — ${msg}\n`);
      process.exit(1);
    }
  }
  summarize(results, args.dryRun);
  process.exit(0);
}

await main();
