#!/usr/bin/env tsx
/**
 * validate-plan-dom-grounding.ts — Phase 6 DOM grounding validator (Stage 1).
 *
 * Closes the v1.0 ROADMAP item "Phase 6 — `@playwright/mcp` Stage 1 enrichment:
 * stub shipped as `scripts/dom-snapshot.ts` — real LLM-side ingestion in
 * analyze.md prompt + locator-table annotation pending".
 *
 * Pairs with `scripts/dom-snapshot.ts` (the capture step) and the new
 * `## DOM grounding (if snapshot present)` block in `prompts/analyze.md`
 * (the ingestion contract). This script is the gate that prevents Sonnet
 * from pinning a locator the snapshot does not back.
 *
 * Contract:
 *   - When `outputs/dom-snapshots/<input-basename>.yaml` exists, every
 *     locator pin in the markdown plan (column "New" of the Locator
 *     translation table) MUST carry a `// dom-snapshot:role=<r>|name=<n>`
 *     annotation in its Notes cell. The role/name pair MUST appear in the
 *     captured accessibility snapshot.
 *   - When the snapshot is ABSENT, we run the OFFLINE ABSTENTION GATE (lever
 *     1): a HIGH-confidence pin whose accessible name is not derivable from
 *     the source (input test + the plan's Original-column selectors) is a
 *     confident hallucination and fails. `low`/`medium` pins and structural
 *     locators (CSS / testid / role-without-name) pass — they are the honest
 *     ways to abstain when there is no SUT to ground against.
 *
 * Exit codes (mirrors `dom-ground.ts` convention):
 *   0 — snapshot present and every pin grounded, OR no snapshot and the
 *       offline abstention gate passed
 *   1 — snapshot present: a pin is unannotated or cites a role/name absent
 *       from the snapshot; OR no snapshot: a high-confidence pin names a
 *       locator not derivable from the source (hallucination candidate)
 *   2 — usage error (missing required args, plan unreadable, snapshot
 *       unreadable when --snapshot was explicit, source unreadable when
 *       --source was explicit)
 *
 * CLI:
 *   npx tsx scripts/validate-plan-dom-grounding.ts \
 *     --plan outputs/plans/<basename>.md \
 *     [--snapshot outputs/dom-snapshots/<basename>.yaml] \
 *     [--source inputs/<framework>/<basename>]
 *
 *   When --snapshot is omitted, the validator derives the path from the
 *   plan basename — same convention `dom-snapshot.ts` writes to. When
 *   --source is omitted the offline gate still runs, using only the plan's
 *   Original column as corpus (degraded but non-zero coverage).
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

interface CliArgs {
  plan: string;
  snapshot: string;
  snapshotExplicit: boolean;
  /** Original input test file — corpus for the offline abstention gate. */
  source: string;
  sourceExplicit: boolean;
}

interface SnapshotNode {
  role: string;
  name: string;
}

interface LocatorPin {
  /** The raw locator expression as written in the plan (without backticks). */
  expression: string;
  /**
   * The text the validator searches for a `// dom-snapshot:...` annotation.
   * For locator-table rows this is the FULL raw markdown row (not the
   * split Notes cell) so the pipe character INSIDE the annotation
   * (`role=...|name=...`) does not collide with the markdown column
   * separator. For hallucination-defense pins this is the pin line.
   */
  notes: string;
  /** 1-based line number of the table row in the plan markdown. */
  line: number;
  /**
   * The Original-column locator (the source selector this pin translates
   * FROM), when present. It is source-derived vocabulary, so it joins the
   * offline abstention corpus. `null` for hallucination-defense pins (no
   * Original column).
   */
  original: string | null;
  /**
   * Parsed Confidence-cell value. `null` when the row has no confidence-
   * shaped cell (treated as an unqualified — i.e. high — assertion by the
   * offline gate). Hallucination-defense pins are excluded from the gate, so
   * their confidence is left `null` and never consulted.
   */
  confidence: "high" | "medium" | "low" | null;
  /** True for rows in the `## Hallucination-defense pins` section. */
  isDefensePin: boolean;
}

interface GroundingAnnotation {
  role: string;
  name: string;
}

interface ValidationFinding {
  pin: LocatorPin;
  kind: "missing-annotation" | "annotation-not-in-snapshot";
  detail: string;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      plan: { type: "string" },
      snapshot: { type: "string" },
      source: { type: "string" },
    },
    strict: true,
  });
  if (!values.plan) {
    process.stderr.write(
      "Usage: validate-plan-dom-grounding --plan <plan.md> [--snapshot <snapshot.yaml>] [--source <input-test>]\n",
    );
    process.exit(2);
  }
  const planPath = values.plan;
  const snapshotExplicit = typeof values.snapshot === "string" && values.snapshot.length > 0;
  const snapshotPath = snapshotExplicit
    ? (values.snapshot as string)
    : deriveSnapshotPath(planPath);
  const sourceExplicit = typeof values.source === "string" && values.source.length > 0;
  return {
    plan: planPath,
    snapshot: snapshotPath,
    snapshotExplicit,
    source: sourceExplicit ? (values.source as string) : "",
    sourceExplicit,
  };
}

/**
 * Derive the conventional snapshot path from a plan path.
 * `outputs/plans/foo.md` → `outputs/dom-snapshots/foo.yaml`
 * Matches the path `scripts/dom-snapshot.ts --output` writes to (per
 * `docs/playwright-mcp-integration.md` §3.1).
 */
function deriveSnapshotPath(planPath: string): string {
  const base = basename(planPath).replace(/\.md$/i, "");
  return join("outputs", "dom-snapshots", `${base}.yaml`);
}

/**
 * Parse the YAML-ish aria snapshot written by `Locator.ariaSnapshot()`.
 *
 * Each accessible node renders as one line shaped like:
 *   - heading "Welcome back, Jane" [level=1]
 *   - button "Sign in"
 *   - textbox "Email"
 *
 * Indentation expresses tree depth; we flatten because role + name is the
 * grounding key (parent context is not part of the annotation contract).
 *
 * Lines starting with `#` are header comments emitted by `dom-snapshot.ts`
 * (URL + timestamp + token estimate) — skip those.
 */
function parseSnapshot(yaml: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  // Pattern: optional leading whitespace + "- " + role + (optional " \"name\"") + optional attrs
  // Role token: lowercase letters + optional hyphens.
  // Name: double-quoted, may contain commas/spaces/escaped quotes.
  const nodeRe = /^\s*-\s+([a-z][a-z-]*)(?:\s+"((?:[^"\\]|\\.)*)")?/;
  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.trimStart().startsWith("#")) continue;
    const match = nodeRe.exec(line);
    if (!match?.[1]) continue;
    const role = match[1];
    const name = match[2] ? unescapeYamlName(match[2]) : "";
    nodes.push({ role, name });
  }
  return nodes;
}

function unescapeYamlName(raw: string): string {
  return raw.replaceAll(/\\(["\\])/g, "$1");
}

/**
 * Extract locator pins from the Locator translation table of the plan
 * markdown. We scan the section "## Locator translation table" and parse
 * every data row; the canonical column order (per analyze.md §4) is:
 *   | Original | New | Confidence | Notes |
 *
 * Some plans add extra columns (Line, Element role, Evidence) — we
 * identify the "New" cell as the second cell that contains a Playwright
 * locator pattern (page.getBy*, page.locator, or backtick-wrapped variant
 * thereof). The Notes cell is the remaining longest text cell.
 *
 * Hallucination-defense pins (separate section) also need annotations —
 * we scan that section too, treating each numbered pin as a row.
 */
function extractLocatorPins(plan: string): LocatorPin[] {
  const pins: LocatorPin[] = [];
  const lines = plan.split("\n");
  let inLocatorTable = false;
  let inHallucinationPins = false;
  let tableSeparatorSeen = false;
  let header: HeaderIdx | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      const name = heading[1].toLowerCase();
      inLocatorTable = name.startsWith("locator translation");
      inHallucinationPins = name.startsWith("hallucination-defense pins");
      tableSeparatorSeen = false;
      header = null;
      continue;
    }

    if (inLocatorTable) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      if (/^\|[\s|:-]+\|$/.test(trimmed)) {
        tableSeparatorSeen = true;
        continue;
      }
      if (!tableSeparatorSeen) {
        // The row before the separator is the header — read its column indices
        // so we can find "New"/"Original"/"Confidence" by NAME, not by guessing
        // which cell is a Playwright locator (which dropped Cypress/Selenium
        // plans whose Original column is cy.get(...) / driver.find_element(...)).
        header = computeHeaderIndices(cells);
        continue;
      }
      // Pass the RAW row text as the annotation search surface — the
      // annotation contains its own `|` (between role= and name=) which
      // would otherwise be eaten by the markdown column split above.
      const pin = pinFromTableRow(cells, trimmed, i + 1, header);
      if (pin) pins.push(pin);
    } else if (inHallucinationPins) {
      // Numbered pin lines like:
      //   1. **Dashboard greeting** — assumed `getByRole('heading', { name: /welcome back/i })`. If DOM contradicts: ...
      // The "assumed `<locator>`" backtick span is the pin's locator;
      // everything after that backtick is the rationale where the
      // annotation comment should live (the validator looks for
      // `// dom-snapshot:role=...|name=...` anywhere in the line).
      const pinLine = /^\s*\d+\.\s.*assumed\s+`([^`]+)`/.exec(line);
      if (pinLine?.[1]) {
        pins.push({
          expression: pinLine[1].trim(),
          notes: line,
          line: i + 1,
          original: null,
          confidence: null,
          isDefensePin: true,
        });
      }
    }
  }
  return pins;
}

interface LocatorCell {
  cell: string;
  idx: number;
  locator: string;
}

function locatorCellsOf(cells: string[]): LocatorCell[] {
  const out: LocatorCell[] = [];
  for (let idx = 0; idx < cells.length; idx++) {
    const cell = cells[idx] ?? "";
    const locator = extractLocatorFromCell(cell);
    if (locator !== null) out.push({ cell, idx, locator });
  }
  return out;
}

interface HeaderIdx {
  original: number;
  new: number;
  confidence: number;
}

/** Map a locator-table header row to the column indices we need, by NAME. */
function computeHeaderIndices(headerCells: string[]): HeaderIdx {
  const find = (...names: string[]): number =>
    headerCells.findIndex((c) => names.includes(c.trim().toLowerCase()));
  return {
    original: find("original", "source", "from", "old"),
    new: find("new", "target", "to", "playwright", "replacement"),
    confidence: find("confidence", "conf"),
  };
}

/** The first backtick-wrapped span of a cell, else the trimmed cell — the
 * Original-column literal in ANY framework's syntax (cy.get, driver.find_element…). */
function extractCellLiteral(cell: string): string | null {
  const m = /`([^`]+)`/.exec(cell);
  const lit = (m?.[1] ?? cell).trim();
  return lit.length > 0 ? lit : null;
}

function pinFromTableRow(cells: string[], rawRow: string, lineNo: number, header: HeaderIdx | null): LocatorPin | null {
  // Header-aware: read the New (Playwright) locator + Original literal by COLUMN
  // INDEX. The New cell is still required to be a Playwright locator (it is the
  // target), but the Original may be native Cypress/Selenium syntax.
  if (header && header.new >= 0) {
    const newLoc = extractLocatorFromCell(cells[header.new] ?? "");
    if (newLoc === null) return null;
    const originalLit = header.original >= 0 ? extractCellLiteral(cells[header.original] ?? "") : null;
    const confidence =
      header.confidence >= 0 ? confidenceFromCells([cells[header.confidence] ?? ""]) : confidenceFromCells(cells);
    return { expression: newLoc, notes: rawRow, line: lineNo, original: originalLit, confidence, isDefensePin: false };
  }
  // Fallback (no recognisable header): the legacy locator-shaped heuristic —
  // the New cell is the SECOND Playwright-locator-shaped cell.
  const locatorCells = locatorCellsOf(cells);
  if (locatorCells.length < 2) return null;
  const newCell = locatorCells[1];
  if (!newCell) return null;
  return {
    expression: newCell.locator,
    notes: rawRow,
    line: lineNo,
    original: locatorCells[0]?.locator ?? null,
    confidence: confidenceFromCells(cells),
    isDefensePin: false,
  };
}

/**
 * Find the Confidence-cell verdict in a locator-table row. The canonical
 * column is a bare `high` / `med` / `low` (analyze.md §4); we tolerate a
 * leading status emoji/symbol. Returns `null` when no cell is *primarily* a
 * confidence marker — the offline gate treats that as an unqualified (high)
 * assertion. We deliberately do NOT scan free-text Notes for these words, so
 * a Notes sentence like "high risk" cannot be misread as the verdict.
 */
function confidenceFromCells(cells: string[]): "high" | "medium" | "low" | null {
  // A confidence cell is the bare verdict, optionally prefixed by a status
  // symbol/emoji (consumed by the leading `[^a-z]*?`). The length guard keeps
  // a long Notes sentence that merely starts with "Low-level…" from being
  // misread — real confidence cells are short.
  const markerRe = /^[^a-z]*?(high|medium|med|low)\b/i;
  for (const cell of cells) {
    const stripped = cell.trim();
    if (stripped.length === 0 || stripped.length > 16) continue;
    const m = markerRe.exec(stripped);
    if (!m?.[1]) continue;
    const v = m[1].toLowerCase();
    return v === "med" ? "medium" : (v as "high" | "low");
  }
  return null;
}

/**
 * Pull a Playwright locator expression out of a markdown table cell.
 * Returns the literal locator text (e.g. `page.getByRole('button', { name: 'Sign in' })`)
 * or null if the cell contains no locator.
 */
function extractLocatorFromCell(cell: string): string | null {
  // Prefer backtick-wrapped content, but fall back to the bare cell if
  // it already starts with page.getBy / page.locator (some plans omit
  // backticks). Look for the FIRST locator-shaped span.
  const backticked = /`([^`]+)`/g;
  for (let match = backticked.exec(cell); match !== null; match = backticked.exec(cell)) {
    const inner = match[1] ?? "";
    if (isLocatorExpression(inner)) return inner.trim();
  }
  if (isLocatorExpression(cell)) return cell.trim();
  return null;
}

function isLocatorExpression(text: string): boolean {
  return (
    /\bpage\.getBy(?:Role|Label|Text|Placeholder|TestId|AltText|Title)\s*\(/.test(text) ||
    /\bpage\.locator\s*\(/.test(text)
  );
}

/**
 * Extract a `// dom-snapshot:role=...|name=...` annotation from arbitrary text.
 * Returns null when no annotation is present.
 *
 * Tolerant of name values containing whitespace or special chars — the
 * annotation runs to end-of-line or to the next markdown table delimiter.
 */
function extractAnnotation(text: string): GroundingAnnotation | null {
  const annotationRe = /\/\/\s*dom-snapshot:role=([^|]+?)\|name=([^|\n]*?)(?:\s*(?:—|--|$|\|))/;
  const match = annotationRe.exec(text);
  if (!match?.[1]) return null;
  const role = match[1].trim().toLowerCase();
  const name = (match[2] ?? "").trim();
  return { role, name };
}

function annotationMatchesSnapshot(annotation: GroundingAnnotation, snapshot: SnapshotNode[]): boolean {
  const targetName = annotation.name.toLowerCase();
  return snapshot.some(
    (node) => node.role.toLowerCase() === annotation.role && node.name.toLowerCase() === targetName,
  );
}

/**
 * The accessible NAME a locator pins, or null for a structural locator that
 * pins no name (the honest offline fallback: `getByTestId`, CSS `page.locator`,
 * or a role with no `name:`). We read the name from `getByRole(..., {name})`
 * and from the sole argument of `getByLabel/Text/Placeholder/AltText/Title`.
 * Both string literals and `/regex/flags` bodies are supported.
 */
function extractAccessibleName(locator: string): string | null {
  // The name argument is either a quoted string or a /regex/. Plan locator
  // strings don't carry escaped quotes, so the simple bodies below suffice.
  const ARG = /(?:'([^']*)'|"([^"]*)"|\/([^/]*)\/[a-z]*)/;
  const fromGroups = (m: RegExpExecArray | null, base: number): string | null => {
    if (!m) return null;
    return (m[base] ?? m[base + 1] ?? m[base + 2] ?? "").trim() || null;
  };
  const roleName = new RegExp(
    String.raw`getByRole\(\s*['"][^'"]+['"]\s*,\s*\{[^}]*?\bname\s*:\s*` + ARG.source,
  ).exec(locator);
  const fromRole = fromGroups(roleName, 1);
  if (fromRole) return fromRole;
  const byName = new RegExp(
    String.raw`getBy(?:Label|Text|Placeholder|AltText|Title)\(\s*` + ARG.source,
  ).exec(locator);
  return fromGroups(byName, 1);
}

const NAME_STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "please", "click", "this", "that", "from",
  "into", "out", "back", "here", "now", "all", "any", "use", "are", "you",
]);

/** Lowercase + collapse every non-alphanumeric run to a single space. */
function normalizeText(s: string): string {
  return s.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
}

/** Same, but with separators removed entirely (`user-name` → `username`). */
function squashText(s: string): string {
  return s.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

/**
 * Is the accessible `name` derivable from the migration source? The corpus is
 * the original input test plus every Original-column selector in the plan —
 * both are source-grounded vocabulary. A name is derivable when every one of
 * its DISTINCTIVE tokens (alphanumeric, length ≥ 3, non-stopword) appears in
 * the corpus, either spaced or squashed (so `Username` matches `user-name`).
 *
 * Names with no distinctive token (e.g. "OK", "Go") get the benefit of the
 * doubt — too short to call a hallucination — and count as derivable.
 */
function nameDerivableFromSource(name: string, corpusNormalized: string, corpusSquashed: string): boolean {
  const tokens = normalizeText(name)
    .split(" ")
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
  if (tokens.length === 0) return true;
  return tokens.every((t) => corpusNormalized.includes(t) || corpusSquashed.includes(t));
}

interface OfflineFinding {
  pin: LocatorPin;
  name: string;
}

/**
 * Offline abstention gate (lever 1). With no DOM snapshot to ground against,
 * a HIGH-confidence pin whose accessible name is not derivable from the source
 * is a confident hallucination — the model asserted a name it has no evidence
 * for. The honest moves the gate forces: lower the confidence and add a
 * hallucination-defense pin, OR fall back to the source selector as CSS
 * (`page.locator('…')`, which pins no name and is skipped here).
 *
 * Only `high` (and unqualified) pins fail; `low`/`medium` pins already flag
 * their own uncertainty (and trip the eval/verify gate downstream), so the gate
 * leaves them alone. Defense-section pins are the escape hatch and are skipped.
 */
function validateOfflineAbstention(plan: string, sourceText: string): OfflineFinding[] {
  const pins = extractLocatorPins(plan);
  const originalCorpus = pins.map((p) => p.original ?? "").join("\n");
  const corpusNormalized = normalizeText(`${sourceText}\n${originalCorpus}`);
  const corpusSquashed = squashText(`${sourceText}\n${originalCorpus}`);
  const findings: OfflineFinding[] = [];
  for (const pin of pins) {
    if (pin.isDefensePin) continue; // honest abstention already — the escape hatch
    if (pin.confidence === "low" || pin.confidence === "medium") continue;
    const name = extractAccessibleName(pin.expression);
    if (!name) continue; // structural locator — the honest CSS/testid fallback
    if (nameDerivableFromSource(name, corpusNormalized, corpusSquashed)) continue;
    findings.push({ pin, name });
  }
  return findings;
}

function validate(plan: string, snapshot: SnapshotNode[]): ValidationFinding[] {
  const pins = extractLocatorPins(plan);
  const findings: ValidationFinding[] = [];
  for (const pin of pins) {
    // getByTestId nodes do not always surface in the aria snapshot
    // (testids are an implementation hint, not an a11y role) — skip
    // grounding for those, but only when the pin has no annotation.
    // This avoids false positives on projects with strict testid-first
    // conventions where the snapshot still validates the role indirectly.
    const annotation = extractAnnotation(pin.notes);
    if (!annotation) {
      // Allow an unannotated `getByTestId` pin to pass — the snapshot's
      // role/name pair cannot encode testid attributes.
      if (/\bpage\.getByTestId\s*\(/.test(pin.expression)) continue;
      findings.push({
        pin,
        kind: "missing-annotation",
        detail: "no `// dom-snapshot:role=...|name=...` annotation in Notes cell",
      });
      continue;
    }
    if (!annotationMatchesSnapshot(annotation, snapshot)) {
      findings.push({
        pin,
        kind: "annotation-not-in-snapshot",
        detail: `annotation role=${annotation.role}|name=${annotation.name} not present in DOM snapshot`,
      });
    }
  }
  return findings;
}

function relForLog(path: string): string {
  const abs = resolve(path);
  if (abs.startsWith(REPO_ROOT + "/") || abs === REPO_ROOT) {
    return abs.slice(REPO_ROOT.length + 1);
  }
  return path;
}

/**
 * No-snapshot path. Without a SUT we can't ground, but we can still refuse a
 * HIGH-confidence pin whose accessible name is absent from the source — that
 * is a confident hallucination (lever 1). When `--source` is omitted we run a
 * degraded gate using only the plan's own Original-column selectors as corpus;
 * either way an explicit miss exits 1.
 */
function runOfflineAbstention(args: CliArgs, planText: string): never {
  let sourceText = "";
  if (args.sourceExplicit) {
    if (!existsSync(args.source)) {
      process.stderr.write(
        `::error::validate-plan-dom-grounding: source not found: ${args.source}\n`,
      );
      process.exit(2);
    }
    sourceText = readFileSync(args.source, "utf-8");
  }
  const findings = validateOfflineAbstention(planText, sourceText);
  const corpus = args.sourceExplicit ? relForLog(args.source) : "plan Original column only";
  if (findings.length === 0) {
    process.stdout.write(
      `validate-plan-dom-grounding: no snapshot — offline abstention gate passed (${relForLog(args.plan)}, corpus: ${corpus}).\n`,
    );
    process.exit(0);
  }
  for (const f of findings) {
    process.stderr.write(
      `::error::Plan ${relForLog(args.plan)} (line ${f.pin.line}) pins '${f.pin.expression}' at HIGH confidence, ` +
        `but its accessible name "${f.name}" is not derivable from the source and there is no DOM snapshot to ground it — ` +
        `confident hallucination. Lower the confidence and add a hallucination-defense pin, or fall back to the source ` +
        `selector as CSS (page.locator('…'), which pins no name).\n`,
    );
  }
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  if (!existsSync(args.plan)) {
    process.stderr.write(`::error::validate-plan-dom-grounding: plan not found: ${args.plan}\n`);
    process.exit(2);
  }
  let planText: string;
  try {
    planText = readFileSync(args.plan, "utf-8");
  } catch (e) {
    process.stderr.write(
      `::error::validate-plan-dom-grounding: cannot read plan: ${describeError(e)}\n`,
    );
    process.exit(2);
  }
  if (!existsSync(args.snapshot)) {
    if (args.snapshotExplicit) {
      process.stderr.write(
        `::error::validate-plan-dom-grounding: snapshot not found: ${args.snapshot}\n`,
      );
      process.exit(2);
    }
    runOfflineAbstention(args, planText);
  }
  let snapshotText: string;
  try {
    snapshotText = readFileSync(args.snapshot, "utf-8");
  } catch (e) {
    process.stderr.write(
      `::error::validate-plan-dom-grounding: cannot read snapshot: ${describeError(e)}\n`,
    );
    process.exit(2);
  }
  const snapshot = parseSnapshot(snapshotText);
  const findings = validate(planText, snapshot);
  if (findings.length === 0) {
    process.stdout.write(
      `validate-plan-dom-grounding: ${relForLog(args.plan)} grounded against ${relForLog(args.snapshot)} (${snapshot.length} a11y node(s)).\n`,
    );
    process.exit(0);
  }
  for (const finding of findings) {
    process.stderr.write(
      `::error::Plan ${relForLog(args.plan)} pins locator '${finding.pin.expression}' not in DOM snapshot. Hallucination candidate. ` +
        `(line ${finding.pin.line}: ${finding.detail})\n`,
    );
  }
  process.exit(1);
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message.split("\n")[0] ?? e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}

await main();
