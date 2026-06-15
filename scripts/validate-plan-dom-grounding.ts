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
 *   - When the snapshot is absent, the validator exits 0 — the analyze.md
 *     prompt documents that DOM grounding is optional / opt-in.
 *
 * Exit codes (mirrors `dom-ground.ts` convention):
 *   0 — no snapshot OR every pin annotated AND grounded
 *   1 — at least one pin missing an annotation OR annotated with a
 *       role/name not present in the snapshot (hallucination candidate)
 *   2 — usage error (missing required args, plan file unreadable, snapshot
 *       file unreadable when --snapshot was explicitly provided)
 *
 * CLI:
 *   npx tsx scripts/validate-plan-dom-grounding.ts \
 *     --plan outputs/plans/<basename>.md \
 *     [--snapshot outputs/dom-snapshots/<basename>.yaml]
 *
 *   When --snapshot is omitted, the validator derives the path from the
 *   plan basename — same convention `dom-snapshot.ts` writes to.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

interface CliArgs {
  plan: string;
  snapshot: string;
  snapshotExplicit: boolean;
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
    },
    strict: true,
  });
  if (!values.plan) {
    process.stderr.write(
      "Usage: validate-plan-dom-grounding --plan <plan.md> [--snapshot <snapshot.yaml>]\n",
    );
    process.exit(2);
  }
  const planPath = values.plan;
  const snapshotExplicit = typeof values.snapshot === "string" && values.snapshot.length > 0;
  const snapshotPath = snapshotExplicit
    ? (values.snapshot as string)
    : deriveSnapshotPath(planPath);
  return { plan: planPath, snapshot: snapshotPath, snapshotExplicit };
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      const name = heading[1].toLowerCase();
      inLocatorTable = name.startsWith("locator translation");
      inHallucinationPins = name.startsWith("hallucination-defense pins");
      tableSeparatorSeen = false;
      continue;
    }

    if (inLocatorTable) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
      if (/^\|[\s|:-]+\|$/.test(trimmed)) {
        tableSeparatorSeen = true;
        continue;
      }
      if (!tableSeparatorSeen) continue; // header row
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      // Pass the RAW row text as the annotation search surface — the
      // annotation contains its own `|` (between role= and name=) which
      // would otherwise be eaten by the markdown column split above.
      const pin = pinFromTableRow(cells, trimmed, i + 1);
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

function pinFromTableRow(cells: string[], rawRow: string, lineNo: number): LocatorPin | null {
  // Identify locator-shaped cells: backtick-wrapped page.getBy* or page.locator.
  const locatorCells = locatorCellsOf(cells);
  if (locatorCells.length < 2) {
    // Need at least Original + New columns to form a pin.
    return null;
  }
  // The "New" cell is the SECOND locator-shaped cell — first is Original.
  const newCell = locatorCells[1];
  if (!newCell) return null;
  // Annotation search surface is the raw row (preserves the `|` inside
  // `role=...|name=...`); see LocatorPin.notes JSDoc.
  return {
    expression: newCell.locator,
    notes: rawRow,
    line: lineNo,
  };
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

async function main(): Promise<void> {
  const args = parseCliArgs();
  if (!existsSync(args.plan)) {
    process.stderr.write(`::error::validate-plan-dom-grounding: plan not found: ${args.plan}\n`);
    process.exit(2);
  }
  if (!existsSync(args.snapshot)) {
    if (args.snapshotExplicit) {
      process.stderr.write(
        `::error::validate-plan-dom-grounding: snapshot not found: ${args.snapshot}\n`,
      );
      process.exit(2);
    }
    process.stdout.write(
      `validate-plan-dom-grounding: no snapshot at ${relForLog(args.snapshot)} — skipping grounding check (offline migration mode).\n`,
    );
    process.exit(0);
  }
  let planText: string;
  let snapshotText: string;
  try {
    planText = readFileSync(args.plan, "utf-8");
  } catch (e) {
    process.stderr.write(
      `::error::validate-plan-dom-grounding: cannot read plan: ${describeError(e)}\n`,
    );
    process.exit(2);
  }
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
