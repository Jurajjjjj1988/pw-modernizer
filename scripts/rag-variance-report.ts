#!/usr/bin/env node
/**
 * rag-variance-report.ts - compare Stage 1 plan-shape variance across
 * STAGE1_RAG modes (shadow vs on) per ADR-0001 Phase 1 exit criteria.
 *
 * Reads the plans table (rag_mode, rag_top_score, locator_count, pin_count,
 * scenario_count) from outputs/.metrics.db. For each mode, computes summary
 * statistics; the operator inspects the shadow -> on delta against the
 * Phase 1 exit thresholds:
 *
 *   - +0.05 absolute lift on selectorQualityScore  (NOT in this script;
 *     measured via per-plan semantic-regression-check.ts)
 *   - OR -1 stddev on the variance axis             (THIS script computes
 *     stddev on locator_count + pin_count + scenario_count)
 *
 * The script reports the variance axis only - the selectorQualityScore axis
 * lives upstream because it needs a per-plan ground-truth comparison.
 *
 * Output:
 *   - Markdown table per metric: count, mean, stddev, p50, p90, plus the
 *     delta (on minus shadow).
 *   - Verdict line: "Phase 1 variance gate: <PASS|HOLD|INSUFFICIENT-DATA>"
 *     - PASS  = stddev decreased by >= 1.0 across the 3 plan-shape metrics
 *     - HOLD  = data exists but the lift is below threshold (more shadow
 *               + on samples needed, OR retrieval needs tuning before flip)
 *     - INSUFFICIENT-DATA = fewer than N samples per mode (default N=5)
 *
 * CLI:
 *   npx tsx scripts/rag-variance-report.ts \
 *     [--db <path>] [--min-samples <n>] [--json] [--quiet]
 *
 * --db          Path to metrics DB (default: outputs/.metrics.db)
 * --min-samples Minimum sample count per mode for the verdict to be
 *               non-INSUFFICIENT-DATA (default: 5, per ADR Phase 1 N=5).
 * --json        Print machine-readable JSON instead of markdown.
 * --quiet       Suppress stderr summary.
 *
 * Exit codes:
 *   0 = PASS or HOLD or INSUFFICIENT-DATA (this script is a signal, not a gate)
 *   1 = DB unreadable or query failure (infrastructure error)
 */

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { MetricsDB } from "./metrics.js";

const DEFAULT_DB = "outputs/.metrics.db";
const DEFAULT_MIN_SAMPLES = 5;
const VARIANCE_DROP_THRESHOLD = 1.0;

interface CliArgs {
  db: string;
  minSamples: number;
  json: boolean;
  quiet: boolean;
}

interface PerMetricStats {
  metric: string;
  shadow: ModeStats;
  on: ModeStats;
  /** Stddev delta = on.stddev - shadow.stddev. Negative = on is more stable. */
  stddevDelta: number | null;
}

interface ModeStats {
  count: number;
  mean: number | null;
  stddev: number | null;
  p50: number | null;
  p90: number | null;
}

interface VarianceReport {
  shadowSampleSize: number;
  onSampleSize: number;
  minSamples: number;
  perMetric: PerMetricStats[];
  topScoreStats: { shadow: ModeStats; on: ModeStats };
  verdict: "PASS" | "HOLD" | "INSUFFICIENT-DATA";
  verdictRationale: string;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      db: { type: "string" },
      "min-samples": { type: "string" },
      json: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
    },
  });
  const minRaw = values["min-samples"];
  let minSamples = DEFAULT_MIN_SAMPLES;
  if (typeof minRaw === "string" && minRaw.length > 0) {
    const parsed = Number.parseInt(minRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      process.stderr.write(`--min-samples must be a positive integer, got '${minRaw}'\n`);
      process.exit(1);
    }
    minSamples = parsed;
  }
  return {
    db: values.db ?? DEFAULT_DB,
    minSamples,
    json: values.json === true,
    quiet: values.quiet === true,
  };
}

function summarise(values: number[]): ModeStats {
  if (values.length === 0) {
    return { count: 0, mean: null, stddev: null, p50: null, p90: null };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = sum / values.length;
  const variance =
    values.length === 1
      ? 0
      : values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (values.length - 1);
  const stddev = Math.sqrt(variance);
  const sorted = [...values].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)] ?? null;
  const p90Index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9)));
  const p90 = sorted[p90Index] ?? null;
  return {
    count: values.length,
    mean: Math.round(mean * 1000) / 1000,
    stddev: Math.round(stddev * 1000) / 1000,
    p50,
    p90,
  };
}

function collectMetric(
  db: MetricsDB,
  column: string,
  mode: "shadow" | "on",
): number[] {
  const rows = db.query(
    `SELECT ${column} AS v FROM plans WHERE rag_mode = '${mode}' AND ${column} IS NOT NULL`,
  );
  const out: number[] = [];
  for (const r of rows) {
    const v = r["v"];
    if (typeof v === "number") out.push(v);
  }
  return out;
}

function buildPerMetric(
  db: MetricsDB,
  metric: string,
  column: string,
): PerMetricStats {
  const shadow = summarise(collectMetric(db, column, "shadow"));
  const on = summarise(collectMetric(db, column, "on"));
  const stddevDelta =
    shadow.stddev === null || on.stddev === null ? null : Math.round((on.stddev - shadow.stddev) * 1000) / 1000;
  return { metric, shadow, on, stddevDelta };
}

function deriveVerdict(
  shadowN: number,
  onN: number,
  perMetric: PerMetricStats[],
  minSamples: number,
): { verdict: VarianceReport["verdict"]; rationale: string } {
  if (shadowN < minSamples || onN < minSamples) {
    return {
      verdict: "INSUFFICIENT-DATA",
      rationale: `Need at least ${minSamples} samples per mode; have shadow=${shadowN} on=${onN}.`,
    };
  }
  // Sum of stddev deltas across the 3 plan-shape metrics. PASS if the
  // aggregate drop crosses the threshold AND every per-metric delta is <= 0
  // (no individual metric got worse).
  let totalDrop = 0;
  for (const m of perMetric) {
    if (m.stddevDelta === null) {
      return {
        verdict: "HOLD",
        rationale: `Metric '${m.metric}' has insufficient variance signal (mode produced too few values).`,
      };
    }
    if (m.stddevDelta > 0) {
      return {
        verdict: "HOLD",
        rationale: `Metric '${m.metric}' got more variable in 'on' mode (delta=+${m.stddevDelta}). Re-tune retrieval before promoting.`,
      };
    }
    totalDrop -= m.stddevDelta;
  }
  if (totalDrop >= VARIANCE_DROP_THRESHOLD) {
    return {
      verdict: "PASS",
      rationale: `Aggregate stddev drop ${totalDrop.toFixed(2)} >= ${VARIANCE_DROP_THRESHOLD.toFixed(2)} - Phase 1 variance gate met. Selector-quality axis must be checked separately via semantic-regression-check.ts.`,
    };
  }
  return {
    verdict: "HOLD",
    rationale: `Aggregate stddev drop ${totalDrop.toFixed(2)} < ${VARIANCE_DROP_THRESHOLD.toFixed(2)}; either accumulate more shadow + on samples or tune retrieval.`,
  };
}

function renderMarkdown(report: VarianceReport): string {
  const lines: string[] = [];
  lines.push("# RAG variance report (Phase 1)");
  lines.push("");
  lines.push(`Samples: shadow=${report.shadowSampleSize}, on=${report.onSampleSize} (min required ${report.minSamples})`);
  lines.push("");
  lines.push("## Plan-shape variance (lower stddev = more stable retrieval)");
  lines.push("");
  lines.push("| Metric | shadow N | shadow mean | shadow stddev | on N | on mean | on stddev | delta |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const m of report.perMetric) {
    const fmt = (v: number | null) => (v === null ? "—" : v.toString());
    const delta = m.stddevDelta === null ? "—" : (m.stddevDelta >= 0 ? "+" : "") + m.stddevDelta.toString();
    lines.push(
      `| ${m.metric} | ${m.shadow.count} | ${fmt(m.shadow.mean)} | ${fmt(m.shadow.stddev)} | ${m.on.count} | ${fmt(m.on.mean)} | ${fmt(m.on.stddev)} | ${delta} |`,
    );
  }
  lines.push("");
  lines.push("## Top-1 BM25 score (informational)");
  lines.push("");
  const ts = report.topScoreStats;
  const fmt = (v: number | null) => (v === null ? "—" : v.toString());
  lines.push("| Mode | N | mean | stddev |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| shadow | ${ts.shadow.count} | ${fmt(ts.shadow.mean)} | ${fmt(ts.shadow.stddev)} |`);
  lines.push(`| on | ${ts.on.count} | ${fmt(ts.on.mean)} | ${fmt(ts.on.stddev)} |`);
  lines.push("");
  lines.push(`**Phase 1 variance gate:** ${report.verdict}`);
  lines.push("");
  lines.push(report.verdictRationale);
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const args = parseCliArgs();
  if (!existsSync(args.db)) {
    process.stderr.write(`metrics DB not found at ${args.db}\n`);
    process.exit(1);
  }
  const db = new MetricsDB(args.db);
  try {
    const perMetric: PerMetricStats[] = [
      buildPerMetric(db, "locator_count", "locator_count"),
      buildPerMetric(db, "pin_count", "pin_count"),
      buildPerMetric(db, "scenario_count", "scenario_count"),
    ];
    const topScoreStats = {
      shadow: summarise(collectMetric(db, "rag_top_score", "shadow")),
      on: summarise(collectMetric(db, "rag_top_score", "on")),
    };
    const shadowN = perMetric[0]?.shadow.count ?? 0;
    const onN = perMetric[0]?.on.count ?? 0;
    const { verdict, rationale } = deriveVerdict(shadowN, onN, perMetric, args.minSamples);
    const report: VarianceReport = {
      shadowSampleSize: shadowN,
      onSampleSize: onN,
      minSamples: args.minSamples,
      perMetric,
      topScoreStats,
      verdict,
      verdictRationale: rationale,
    };
    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write(renderMarkdown(report));
    }
    if (!args.quiet) {
      process.stderr.write(
        `rag-variance: shadow=${shadowN} on=${onN} verdict=${verdict}\n`,
      );
    }
  } finally {
    db.close();
  }
}

main();
