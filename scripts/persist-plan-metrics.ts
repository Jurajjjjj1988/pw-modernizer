#!/usr/bin/env node
/**
 * persist-plan-metrics.ts — Stage 1 metrics writer.
 *
 * Reads the plan envelope JSON (already a structured contract — see
 * scripts/plan-envelope.schema.json), extracts counts + cited KB-IDs, and
 * writes one row to the `plans` table via MetricsDB.recordPlan().
 *
 * Wired into plan.yml after "Compute severity histogram". Wrapped in
 * try/catch on the workflow side so a metrics write failure cannot fail
 * Stage 1 — the DB is a local reporting cache (see scripts/metrics.ts).
 *
 * Usage:
 *   npx tsx scripts/persist-plan-metrics.ts --envelope <path>
 *
 * Env vars:
 *   METRICS_DB    optional, defaults to outputs/.metrics.db (matches evaluate.ts).
 *   GITHUB_SHA    optional, defaults to "local" (matches evaluate.ts).
 *
 * KB-ID extraction:
 *   Scans locatorTable[].notes for two formats accepted by scripts/kb-validate.ts:
 *     - Old numeric: KB-N.N.N
 *     - New kebab:   <fw>/<topic>/<name> where fw ∈ {pw,cy,sel}
 *   Deduplicates within a single plan. The metrics-report CLI aggregates
 *   "top-N cited" across all recorded plans.
 *
 * Strict TS, no any.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { type Framework } from "./lib/frameworks.js";
import { MetricsDB, type RagPlanColumns, type UsageStats } from "./metrics.js";

interface CliArgs {
  envelope: string;
  /** Optional path to a UsageStats JSON file (output of extract-claude-usage.ts). */
  usage: string | null;
  /** Optional path to the Phase 1 RAG retrieval JSON sidecar produced by Stage 0.5. */
  ragReport: string | null;
  /** STAGE1_RAG mode the workflow ran under (off | shadow | on). null when pre-Phase-1. */
  ragMode: "off" | "shadow" | "on" | null;
}

interface LocatorRow {
  original: string;
  target: string;
  confidence: "high" | "med" | "low";
  notes?: string;
}

interface PinRow {
  pinId: number;
}

interface Scenario {
  id: string;
}

interface Envelope {
  inputBasename: string;
  sourceFramework: Framework;
  subtractive: boolean;
  scenarios: Scenario[];
  locatorTable: LocatorRow[];
  hallucinationDefensePins: PinRow[];
}

const KB_OLD_FORMAT = /\bKB-(\d+\.\d+\.\d+)\b/g;
const KB_NEW_FORMAT = /\b((?:pw|cy|sel)\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)\b/g;

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      envelope: { type: "string" },
      usage: { type: "string" },
      "rag-report": { type: "string" },
      "rag-mode": { type: "string" },
    },
  });
  if (typeof values.envelope !== "string" || values.envelope.length === 0) {
    throw new Error("--envelope is required");
  }
  let ragMode: CliArgs["ragMode"] = null;
  if (typeof values["rag-mode"] === "string" && values["rag-mode"].length > 0) {
    const m = values["rag-mode"];
    if (m !== "off" && m !== "shadow" && m !== "on") {
      throw new Error(`--rag-mode must be off|shadow|on, got '${m}'`);
    }
    ragMode = m;
  }
  return {
    envelope: values.envelope,
    usage: typeof values.usage === "string" && values.usage.length > 0 ? values.usage : null,
    ragReport: typeof values["rag-report"] === "string" && values["rag-report"].length > 0 ? values["rag-report"] : null,
    ragMode,
  };
}

interface RagSidecarEntry {
  id: string;
  score: number;
}

/**
 * Read the Phase 1 RAG retrieval sidecar (outputs/reports/<basename>-rag.json)
 * written by `scripts/retrieval-bm25.ts`. Returns a normalised RagPlanColumns
 * suitable for MetricsDB.recordPlan(). Missing file or unreadable JSON →
 * null (workflow treated as untracked); empty array → mode-only row with
 * null ids + score.
 */
function loadRag(report: string | null, mode: CliArgs["ragMode"]): RagPlanColumns | null {
  if (mode === null) return null;
  if (mode === "off") {
    return { mode, retrieved_ids: null, top_score: null };
  }
  if (report === null || !existsSync(report)) {
    // Mode is shadow/on but no sidecar reached this step - persist mode
    // with NULL ids + score so the dashboard shows "Stage 0.5 ran but did
    // not write a sidecar" as a distinct state from "pre-Phase-1".
    return { mode, retrieved_ids: null, top_score: null };
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(report, "utf8"));
    if (!Array.isArray(raw)) {
      return { mode, retrieved_ids: null, top_score: null };
    }
    const rows = raw as RagSidecarEntry[];
    const ids = rows.map((r) => r.id);
    const top = rows.length > 0 ? (rows[0]?.score ?? null) : null;
    return { mode, retrieved_ids: ids, top_score: top };
  } catch {
    return { mode, retrieved_ids: null, top_score: null };
  }
}

/**
 * Load a UsageStats JSON file produced by extract-claude-usage.ts. Missing
 * file (e.g. workflow didn't capture --output-format json) → return null;
 * downstream persists the row without cost columns, dashboard shows it as
 * "untracked".
 */
function loadUsage(path: string | null): UsageStats | null {
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

function extractKbIdsFromNotes(notes: string): string[] {
  const ids = new Set<string>();
  for (const m of notes.matchAll(KB_OLD_FORMAT)) {
    const id = m[1];
    if (id !== undefined) ids.add(`KB-${id}`);
  }
  for (const m of notes.matchAll(KB_NEW_FORMAT)) {
    const id = m[1];
    if (id !== undefined) ids.add(id);
  }
  return Array.from(ids);
}

function collectCitedKbIds(envelope: Envelope): string[] {
  const all = new Set<string>();
  for (const row of envelope.locatorTable) {
    if (typeof row.notes !== "string" || row.notes.length === 0) continue;
    for (const id of extractKbIdsFromNotes(row.notes)) {
      all.add(id);
    }
  }
  return Array.from(all);
}

function main(): void {
  const args = parseCliArgs();
  const raw: unknown = JSON.parse(readFileSync(args.envelope, "utf8"));
  // Trust the envelope was schema-validated upstream (plan.yml runs
  // plan-envelope-validate.ts before this step). Defensive shape check only.
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`envelope is not a JSON object: ${args.envelope}`);
  }
  const envelope = raw as Envelope;

  const dbPath = process.env["METRICS_DB"] ?? "outputs/.metrics.db";
  const commitSha = process.env["GITHUB_SHA"] ?? "local";

  const usage = loadUsage(args.usage);
  const rag = loadRag(args.ragReport, args.ragMode);

  const db = new MetricsDB(dbPath);
  try {
    db.recordPlan({
      input_basename: basename(envelope.inputBasename),
      source_framework: envelope.sourceFramework,
      subtractive: envelope.subtractive,
      locator_count: envelope.locatorTable.length,
      pin_count: envelope.hallucinationDefensePins.length,
      scenario_count: envelope.scenarios.length,
      kb_ids_cited: collectCitedKbIds(envelope),
      commit_sha: commitSha,
      usage,
      rag,
    });
  } finally {
    db.close();
  }
  const usageNote = usage ? ` [model=${usage.model}, in=${usage.input_tokens}, out=${usage.output_tokens}]` : " [usage:untracked]";
  let ragNote = "";
  if (rag) {
    const countSuffix = rag.retrieved_ids === null ? "" : `,n=${rag.retrieved_ids.length}`;
    ragNote = ` [rag:${rag.mode}${countSuffix}]`;
  }
  process.stdout.write(
    `persist-plan-metrics: recorded ${envelope.inputBasename} (` +
      `${envelope.scenarios.length} scenario(s), ` +
      `${envelope.locatorTable.length} locator(s), ` +
      `${envelope.hallucinationDefensePins.length} pin(s))${usageNote}${ragNote}\n`,
  );
}

main();
