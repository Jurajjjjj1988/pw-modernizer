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

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { MetricsDB } from "./metrics.js";

interface CliArgs {
  envelope: string;
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
  sourceFramework: "bad-playwright" | "selenium-java" | "selenium-python" | "cypress";
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
    },
  });
  if (typeof values.envelope !== "string" || values.envelope.length === 0) {
    throw new Error("--envelope is required");
  }
  return { envelope: values.envelope };
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
    });
  } finally {
    db.close();
  }
  process.stdout.write(
    `persist-plan-metrics: recorded ${envelope.inputBasename} (` +
      `${envelope.scenarios.length} scenario(s), ` +
      `${envelope.locatorTable.length} locator(s), ` +
      `${envelope.hallucinationDefensePins.length} pin(s))\n`,
  );
}

main();
