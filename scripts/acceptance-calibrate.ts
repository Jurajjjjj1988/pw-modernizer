#!/usr/bin/env tsx
/**
 * acceptance-calibrate.ts — turn human acceptance labels into a defensible number.
 *
 * Reads `labels/acceptance.jsonl` (verdicts per migration, see
 * docs/acceptance-rubric.md), joins each LABELED migration to its scorer
 * confidence in `outputs/.metrics.db` (latest run per input_basename), and
 * reports:
 *   1. the acceptance RATE with a Wilson 95% CI (never a bare point estimate);
 *   2. how well the confidence gate predicts ACCEPTABLE, and the threshold that
 *      predicts it best — so the hard-coded 0.7 gate can be calibrated, not guessed.
 *
 * Pure core (calibrate / bestThreshold) is unit-tested; main() is the I/O shell.
 *
 *   npx tsx scripts/acceptance-calibrate.ts [--labels labels/acceptance.jsonl] [--db outputs/.metrics.db]
 *
 * Exit 0 always (reporting tool); prints a clear "N awaiting review" when unlabeled.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { wilsonInterval, formatInterval, type Interval } from "./lib/binom.js";
import { MetricsDB } from "./metrics.js";

export type Verdict = "ACCEPTABLE" | "NOT_ACCEPTABLE" | "UNLABELED";

export interface LabelRecord {
  input_basename: string;
  framework: string;
  verdict: Verdict;
  reasons: string[];
  rater: string;
  date: string;
  notes?: string;
}

export interface LabeledPoint {
  input_basename: string;
  acceptable: boolean;
  confidence: number;
}

export interface ThresholdStat {
  threshold: number;
  /** P(predict acceptable | actually acceptable) */
  sensitivity: number;
  /** P(predict not | actually not) */
  specificity: number;
  accuracy: number;
  /** Youden's J = sensitivity + specificity − 1 (robust to class imbalance). */
  youden: number;
}

export interface Calibration {
  n: number;
  acceptable: number;
  acceptanceRate: Interval;
  thresholds: ThresholdStat[];
  best: ThresholdStat | null;
  /** How the currently-shipped 0.7 gate scores on this data. */
  atPoint7: ThresholdStat | null;
}

/** Stats for "predict acceptable iff confidence >= threshold" against the labels. */
function statAt(points: LabeledPoint[], threshold: number): ThresholdStat {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (const p of points) {
    const predict = p.confidence >= threshold;
    if (predict && p.acceptable) tp += 1;
    else if (predict && !p.acceptable) fp += 1;
    else if (!predict && p.acceptable) fn += 1;
    else tn += 1;
  }
  const pos = tp + fn;
  const neg = tn + fp;
  const sensitivity = pos === 0 ? 1 : tp / pos;
  const specificity = neg === 0 ? 1 : tn / neg;
  const accuracy = points.length === 0 ? 0 : (tp + tn) / points.length;
  return { threshold, sensitivity, specificity, accuracy, youden: sensitivity + specificity - 1 };
}

/**
 * Calibrate the confidence gate against acceptance labels. Candidate thresholds
 * are the observed confidences (so the sweep lands on real decision boundaries)
 * plus the shipped 0.7. "best" maximises Youden's J, tie-broken by accuracy.
 */
export function calibrate(points: LabeledPoint[]): Calibration {
  const acceptable = points.filter((p) => p.acceptable).length;
  const acceptanceRate = wilsonInterval(acceptable, points.length);
  if (points.length === 0) {
    return { n: 0, acceptable: 0, acceptanceRate, thresholds: [], best: null, atPoint7: null };
  }
  const candidates = [...new Set([0.7, ...points.map((p) => p.confidence)])].sort((a, b) => a - b);
  const thresholds = candidates.map((t) => statAt(points, t));
  const best = thresholds.reduce((a, b) =>
    b.youden > a.youden || (b.youden === a.youden && b.accuracy > a.accuracy) ? b : a,
  );
  return { n: points.length, acceptable, acceptanceRate, thresholds, best, atPoint7: statAt(points, 0.7) };
}

// ---- I/O shell ------------------------------------------------------------

function parseLabels(path: string): LabelRecord[] {
  if (!existsSync(path)) return [];
  const out: LabelRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      out.push(JSON.parse(t) as LabelRecord);
    } catch {
      process.stderr.write(`::warning::acceptance-calibrate: skipping unparseable label line\n`);
    }
  }
  return out;
}

/** Latest scorer confidence per input_basename from the metrics DB. */
function latestConfidence(dbPath: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!existsSync(dbPath)) return map;
  const db = new MetricsDB(dbPath);
  try {
    const rows = db.query(
      `SELECT input_basename, aggregate_confidence FROM migrations m
       WHERE created_at = (SELECT MAX(created_at) FROM migrations m2 WHERE m2.input_basename = m.input_basename)`,
    );
    for (const r of rows) {
      const name = String((r as { input_basename?: unknown }).input_basename ?? "");
      const conf = Number((r as { aggregate_confidence?: unknown }).aggregate_confidence ?? Number.NaN);
      if (name && Number.isFinite(conf)) map.set(name, conf);
    }
  } finally {
    db.close();
  }
  return map;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      labels: { type: "string", default: "labels/acceptance.jsonl" },
      db: { type: "string", default: "outputs/.metrics.db" },
    },
    strict: true,
  });
  const labels = parseLabels(values.labels ?? "labels/acceptance.jsonl");
  const labeled = labels.filter((l) => l.verdict === "ACCEPTABLE" || l.verdict === "NOT_ACCEPTABLE");
  const unlabeled = labels.filter((l) => l.verdict === "UNLABELED");
  const conf = latestConfidence(values.db ?? "outputs/.metrics.db");

  const points: LabeledPoint[] = [];
  const noConfidence: string[] = [];
  for (const l of labeled) {
    const c = conf.get(l.input_basename);
    if (c === undefined) noConfidence.push(l.input_basename);
    else points.push({ input_basename: l.input_basename, acceptable: l.verdict === "ACCEPTABLE", confidence: c });
  }

  const cal = calibrate(points);
  const out: string[] = [];
  out.push("# Acceptance calibration\n");
  out.push(`Labels: ${labels.length} total — ${labeled.length} labeled, ${unlabeled.length} awaiting review.`);
  if (noConfidence.length > 0) {
    out.push(`No metrics-DB confidence for ${noConfidence.length} labeled migration(s): ${noConfidence.join(", ")} (run them through evaluate first).`);
  }
  if (points.length === 0) {
    out.push("\n**Not enough data to compute a rate.** Fill in verdicts in labels/acceptance.jsonl");
    out.push("(see docs/acceptance-rubric.md), ensure each migration has been scored, then re-run.");
    process.stdout.write(out.join("\n") + "\n");
    return;
  }
  out.push(`\n**Acceptance rate: ${formatInterval(cal.acceptanceRate)}** (${cal.acceptable}/${cal.n}).`);
  if (cal.n < 30) {
    out.push(`⚠️  n=${cal.n} is small — the interval is wide on purpose. Aim for ≥30 labels before quoting a headline %.`);
  }
  if (cal.best) {
    out.push(
      `\nGate calibration (predict ACCEPTABLE iff confidence ≥ t):` +
        `\n  best threshold: ${cal.best.threshold.toFixed(2)} ` +
        `(accuracy ${(cal.best.accuracy * 100).toFixed(0)}%, sensitivity ${(cal.best.sensitivity * 100).toFixed(0)}%, specificity ${(cal.best.specificity * 100).toFixed(0)}%, Youden ${cal.best.youden.toFixed(2)})`,
    );
  }
  if (cal.atPoint7) {
    out.push(
      `  shipped 0.70 gate: accuracy ${(cal.atPoint7.accuracy * 100).toFixed(0)}%, ` +
        `sensitivity ${(cal.atPoint7.sensitivity * 100).toFixed(0)}%, specificity ${(cal.atPoint7.specificity * 100).toFixed(0)}%`,
    );
  }
  process.stdout.write(out.join("\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
