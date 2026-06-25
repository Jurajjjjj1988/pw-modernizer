#!/usr/bin/env tsx
/**
 * measure-framework.ts — per-framework measured quality + promotion gate
 * (audit: cypress-selenium-never-reach-output).
 *
 * Only bad-Playwright was ever measured; Cypress + Selenium are "example status"
 * and the 70% promotion gate has ZERO datapoints for 3 of 4 frameworks. This
 * makes the gate COMPUTABLE: it segments the metrics DB + acceptance labels BY
 * framework and reports, per framework, the sample size, mean scorer confidence,
 * the human-acceptance rate with a Wilson interval, and whether it clears the
 * promotion bar (acceptance lower-CI-bound ≥ 0.70 with a real sample). On the
 * current repo it honestly shows 0 measured migrations for Cypress/Selenium —
 * the runs themselves (Stage 1 → Stage 2 on the real corpora) are the user's
 * step; this is the meter, the runs are the fuel.
 *
 *   npx tsx scripts/measure-framework.ts [--db outputs/.metrics.db] [--labels labels/acceptance.jsonl] [--bar 0.7] [--min-n 10]
 *
 * Always exits 0 (reporting). Pure core (summariseFrameworks) is unit-tested.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { wilsonInterval, formatInterval } from "./lib/binom.js";
import { MetricsDB } from "./metrics.js";

export interface MigrationPoint {
  input_basename: string;
  framework: string;
  confidence: number;
  /** Human verdict if labeled, else null. */
  acceptable: boolean | null;
}

export interface FrameworkSummary {
  framework: string;
  migrations: number;
  meanConfidence: number | null;
  labeled: number;
  acceptanceRate: string;
  /** Promotion verdict at the bar. */
  promoted: boolean;
  reason: string;
}

const ALL_FRAMEWORKS = ["bad-playwright", "cypress", "selenium-java", "selenium-python"];

export function summariseFrameworks(points: MigrationPoint[], bar = 0.7, minN = 10): FrameworkSummary[] {
  const byFw = new Map<string, MigrationPoint[]>();
  for (const fw of ALL_FRAMEWORKS) byFw.set(fw, []);
  for (const p of points) {
    if (!byFw.has(p.framework)) byFw.set(p.framework, []);
    byFw.get(p.framework)?.push(p);
  }
  const out: FrameworkSummary[] = [];
  for (const [framework, ps] of byFw) {
    const migrations = new Set(ps.map((p) => p.input_basename)).size;
    const meanConfidence = ps.length > 0 ? ps.reduce((s, p) => s + p.confidence, 0) / ps.length : null;
    const labeledPts = ps.filter((p) => p.acceptable !== null);
    const accepted = labeledPts.filter((p) => p.acceptable === true).length;
    const ci = wilsonInterval(accepted, labeledPts.length);
    let promoted = false;
    let reason: string;
    if (labeledPts.length === 0) {
      reason = migrations === 0 ? "no migrations measured yet — run the corpus" : `${migrations} measured but 0 human-labeled — label them (docs/acceptance-rubric.md)`;
    } else if (labeledPts.length < minN) {
      reason = `only ${labeledPts.length} labeled (need ≥${minN}); interval ${formatInterval(ci)} too wide to promote`;
    } else if (ci.lo >= bar) {
      promoted = true;
      reason = `acceptance ${formatInterval(ci)} — lower bound ≥ ${bar.toFixed(2)} bar ✓`;
    } else {
      reason = `acceptance ${formatInterval(ci)} — lower bound < ${bar.toFixed(2)} bar`;
    }
    out.push({
      framework,
      migrations,
      meanConfidence,
      labeled: labeledPts.length,
      acceptanceRate: labeledPts.length > 0 ? formatInterval(ci) : "—",
      promoted,
      reason,
    });
  }
  return out;
}

// ---- I/O shell ----

interface LabelRecord { input_basename: string; verdict: string }

function loadAcceptance(path: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t) as LabelRecord;
      if (r.verdict === "ACCEPTABLE") map.set(r.input_basename, true);
      else if (r.verdict === "NOT_ACCEPTABLE") map.set(r.input_basename, false);
    } catch { /* skip */ }
  }
  return map;
}

function loadPoints(dbPath: string, labels: Map<string, boolean>): MigrationPoint[] {
  if (!existsSync(dbPath)) return [];
  const db = new MetricsDB(dbPath);
  try {
    const rows = db.query(
      `SELECT input_basename, source_framework, aggregate_confidence FROM migrations m
       WHERE created_at = (SELECT MAX(created_at) FROM migrations m2 WHERE m2.input_basename = m.input_basename)`,
    );
    return rows.map((r) => {
      const o = r as { input_basename?: unknown; source_framework?: unknown; aggregate_confidence?: unknown };
      const name = String(o.input_basename ?? "");
      return {
        input_basename: name,
        framework: String(o.source_framework ?? "unknown"),
        confidence: Number(o.aggregate_confidence ?? 0),
        acceptable: labels.has(name) ? (labels.get(name) ?? null) : null,
      };
    });
  } finally {
    db.close();
  }
}

function main(): void {
  const { values } = parseArgs({
    options: {
      db: { type: "string", default: "outputs/.metrics.db" },
      labels: { type: "string", default: "labels/acceptance.jsonl" },
      bar: { type: "string", default: "0.7" },
      "min-n": { type: "string", default: "10" },
    },
    strict: true,
  });
  const labels = loadAcceptance(values.labels ?? "labels/acceptance.jsonl");
  const points = loadPoints(values.db ?? "outputs/.metrics.db", labels);
  const rows = summariseFrameworks(points, Number(values.bar ?? "0.7"), Number(values["min-n"] ?? "10"));
  process.stdout.write("# Per-framework measured quality + promotion gate\n\n");
  process.stdout.write("| framework | migrations | mean conf | labeled | acceptance | promoted? |\n");
  process.stdout.write("|---|---|---|---|---|---|\n");
  for (const r of rows) {
    const mc = r.meanConfidence === null ? "—" : r.meanConfidence.toFixed(2);
    process.stdout.write(`| ${r.framework} | ${r.migrations} | ${mc} | ${r.labeled} | ${r.acceptanceRate} | ${r.promoted ? "✅" : "—"} |\n`);
  }
  process.stdout.write("\n");
  for (const r of rows) process.stdout.write(`- **${r.framework}**: ${r.reason}\n`);
  process.stdout.write("\nThe 70% gate is now computable. Cypress/Selenium promotion needs their corpora RUN (Stage 1→2) then human-labeled — this is the meter, not the runs.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
