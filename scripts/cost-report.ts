#!/usr/bin/env node
/**
 * cost-report.ts — headless CLI version of the dashboard's 3 cost panels.
 *
 * Same SQLite source as the web dashboard (`outputs/.metrics.db`), printed
 * to stdout in either pretty-table (human, Slack-friendly) or JSON
 * (machine-readable) mode. Built for operators who want a weekly summary
 * without booting the dashboard server.
 *
 * Three panels rendered:
 *   A) Cost this week    — last 7 days total + per-stage + delta vs prior week
 *   B) Cost per outcome  — avg USD per migration grouped by verify verdict
 *   C) ROI vs hand       — pipeline spend vs displaced human-hour cost
 *
 * The aggregations are computed locally here — they intentionally do NOT
 * import from `dashboard.ts` because dashboard.ts has module-load side
 * effects (reads `dashboard.html` at startup; calls `main()` at end-of-file).
 * Both files read the same SQLite columns via the shared `MetricsDB` class,
 * so the numbers match by construction.
 *
 * Usage:
 *   npx tsx scripts/cost-report.ts [--db outputs/.metrics.db] [--json]
 *
 * Strict TS, no any.
 */

import { parseArgs } from "node:util";
import { MetricsDB, type QueryRow } from "./metrics.js";

interface CliArgs {
  db: string;
  json: boolean;
}

interface WeeklyCostPanel {
  totalLast7DaysUsd: number;
  totalPrev7DaysUsd: number;
  deltaPct: number | null;
  byStage: Array<{ stage: "plan" | "migration" | "verification"; costUsd: number }>;
  migrationsLast7Days: number;
}

interface CostPerOutcomeRow {
  outcome: "SHIP IT" | "FIX FIRST" | "START OVER" | "BLOCKED-BY-VALIDATOR";
  migrationCount: number;
  totalCostUsd: number;
  avgCostUsd: number;
}

interface RoiPanel {
  pipelineCostUsd: number;
  successfulMigrations: number;
  humanHoursPerTest: number;
  humanHourlyRateUsd: number;
  humanHoursSaved: number;
  humanCostUsd: number;
  roiMultiplier: number | null;
  rateFromEnv: boolean;
}

interface CostReport {
  generatedAtUnix: number;
  weeklyCost: WeeklyCostPanel;
  costPerOutcome: CostPerOutcomeRow[];
  roi: RoiPanel;
}

const ROI_DEFAULT_HOURS_PER_TEST = 4;
const ROI_DEFAULT_HOURLY_RATE_USD = 80;
const SECONDS_PER_DAY = 86_400;

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      db: { type: "string", default: "outputs/.metrics.db" },
      json: { type: "boolean", default: false },
    },
  });
  return {
    db: typeof values.db === "string" ? values.db : "outputs/.metrics.db",
    json: values.json === true,
  };
}

function num(row: QueryRow, key: string): number {
  const v = row[key];
  return typeof v === "number" ? v : 0;
}

function str(row: QueryRow, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

/** Same parsing rules as dashboard.ts:readHumanHourlyRate — kept in sync. */
function readHumanHourlyRate(): { rate: number; fromEnv: boolean } {
  const raw = process.env["PWM_HUMAN_HOUR_COST_USD"];
  if (typeof raw !== "string" || raw.length === 0) {
    return { rate: ROI_DEFAULT_HOURLY_RATE_USD, fromEnv: false };
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { rate: ROI_DEFAULT_HOURLY_RATE_USD, fromEnv: false };
  }
  return { rate: parsed, fromEnv: true };
}

function buildWeeklyCost(db: MetricsDB): WeeklyCostPanel {
  const nowUnix = Math.floor(Date.now() / 1000);
  const day0 = nowUnix - 7 * SECONDS_PER_DAY;
  const day7 = nowUnix - 14 * SECONDS_PER_DAY;

  const last7 = db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM (
       SELECT created_at, cost_usd FROM migrations
       UNION ALL SELECT created_at, cost_usd FROM plans
       UNION ALL SELECT created_at, cost_usd FROM verifications
     )
     WHERE created_at >= ${day0}`,
  )[0] ?? {};

  const prev7 = db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM (
       SELECT created_at, cost_usd FROM migrations
       UNION ALL SELECT created_at, cost_usd FROM plans
       UNION ALL SELECT created_at, cost_usd FROM verifications
     )
     WHERE created_at >= ${day7} AND created_at < ${day0}`,
  )[0] ?? {};

  const planSum = db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM plans WHERE created_at >= ${day0}`,
  )[0] ?? {};
  const migrationSum = db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM migrations WHERE created_at >= ${day0}`,
  )[0] ?? {};
  const verificationSum = db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM verifications WHERE created_at >= ${day0}`,
  )[0] ?? {};

  const migrationsCountRow = db.query(
    `SELECT COUNT(*) AS count FROM migrations WHERE created_at >= ${day0}`,
  )[0] ?? {};

  const totalLast = num(last7, "total");
  const totalPrev = num(prev7, "total");
  const deltaPct = totalPrev > 0 ? (totalLast - totalPrev) / totalPrev : null;

  return {
    totalLast7DaysUsd: totalLast,
    totalPrev7DaysUsd: totalPrev,
    deltaPct,
    byStage: [
      { stage: "plan", costUsd: num(planSum, "total") },
      { stage: "migration", costUsd: num(migrationSum, "total") },
      { stage: "verification", costUsd: num(verificationSum, "total") },
    ],
    migrationsLast7Days: num(migrationsCountRow, "count"),
  };
}

function buildCostPerOutcome(db: MetricsDB): CostPerOutcomeRow[] {
  const costRows = db.query(
    `SELECT input_basename,
            COALESCE(SUM(cost_usd), 0) AS total
     FROM (
       SELECT input_basename, cost_usd FROM migrations
       UNION ALL SELECT input_basename, cost_usd FROM plans
       UNION ALL SELECT input_basename, cost_usd FROM verifications
     )
     WHERE cost_usd IS NOT NULL
     GROUP BY input_basename`,
  );
  const costByBasename = new Map<string, number>();
  for (const r of costRows) {
    const basename = str(r, "input_basename");
    if (!basename) continue;
    costByBasename.set(basename, num(r, "total"));
  }

  const verdictRows = db.query(
    `SELECT input_basename, verdict, created_at
     FROM verifications
     ORDER BY created_at DESC`,
  );
  const verdictByBasename = new Map<string, string>();
  for (const r of verdictRows) {
    const basename = str(r, "input_basename");
    if (!basename || verdictByBasename.has(basename)) continue;
    verdictByBasename.set(basename, str(r, "verdict"));
  }

  const buckets: Record<CostPerOutcomeRow["outcome"], { count: number; total: number }> = {
    "SHIP IT": { count: 0, total: 0 },
    "FIX FIRST": { count: 0, total: 0 },
    "START OVER": { count: 0, total: 0 },
    "BLOCKED-BY-VALIDATOR": { count: 0, total: 0 },
  };

  for (const [basename, costUsd] of costByBasename.entries()) {
    const verdict = verdictByBasename.get(basename);
    let bucket: CostPerOutcomeRow["outcome"];
    if (verdict === "SHIP IT" || verdict === "FIX FIRST" || verdict === "START OVER") {
      bucket = verdict;
    } else {
      bucket = "BLOCKED-BY-VALIDATOR";
    }
    buckets[bucket].count += 1;
    buckets[bucket].total += costUsd;
  }

  const order: Array<CostPerOutcomeRow["outcome"]> = [
    "SHIP IT",
    "FIX FIRST",
    "START OVER",
    "BLOCKED-BY-VALIDATOR",
  ];
  return order.map((outcome) => {
    const { count, total } = buckets[outcome];
    return {
      outcome,
      migrationCount: count,
      totalCostUsd: total,
      avgCostUsd: count === 0 ? 0 : total / count,
    };
  });
}

function buildRoi(db: MetricsDB): RoiPanel {
  const { rate, fromEnv } = readHumanHourlyRate();
  const hoursPerTest = ROI_DEFAULT_HOURS_PER_TEST;

  const pipelineCostRow = db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM (
       SELECT cost_usd FROM migrations
       UNION ALL SELECT cost_usd FROM plans
       UNION ALL SELECT cost_usd FROM verifications
     )`,
  )[0] ?? {};
  const pipelineCostUsd = num(pipelineCostRow, "total");

  const successRow = db.query(
    `SELECT COUNT(DISTINCT input_basename) AS count
     FROM verifications
     WHERE verdict IN ('SHIP IT', 'FIX FIRST')`,
  )[0] ?? {};
  const successfulMigrations = num(successRow, "count");

  const humanHoursSaved = successfulMigrations * hoursPerTest;
  const humanCostUsd = humanHoursSaved * rate;
  const roiMultiplier = pipelineCostUsd > 0 ? humanCostUsd / pipelineCostUsd : null;

  return {
    pipelineCostUsd,
    successfulMigrations,
    humanHoursPerTest: hoursPerTest,
    humanHourlyRateUsd: rate,
    humanHoursSaved,
    humanCostUsd,
    roiMultiplier,
    rateFromEnv: fromEnv,
  };
}

function buildReport(db: MetricsDB): CostReport {
  return {
    generatedAtUnix: Math.floor(Date.now() / 1000),
    weeklyCost: buildWeeklyCost(db),
    costPerOutcome: buildCostPerOutcome(db),
    roi: buildRoi(db),
  };
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return "n/a (no prior spend)";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

/** Pretty-print a 3-section text report, Slack-friendly. */
function renderText(report: CostReport): string {
  const lines: string[] = [];
  const ts = new Date(report.generatedAtUnix * 1000).toISOString().slice(0, 19).replace("T", " ");
  lines.push(`PWmodernizer cost report — ${ts} UTC`);
  lines.push("");

  // Panel A
  const wc = report.weeklyCost;
  lines.push("== Panel A — Cost this week ==");
  lines.push(`  Last 7 days:  ${fmtUsd(wc.totalLast7DaysUsd)}`);
  lines.push(`  Prev 7 days:  ${fmtUsd(wc.totalPrev7DaysUsd)}`);
  lines.push(`  Delta:        ${fmtPct(wc.deltaPct)}`);
  lines.push(`  Migrations:   ${wc.migrationsLast7Days} this week`);
  lines.push(`  By stage:`);
  for (const s of wc.byStage) {
    lines.push(`    ${s.stage.padEnd(14)} ${fmtUsd(s.costUsd)}`);
  }
  lines.push("");

  // Panel B
  lines.push("== Panel B — Cost per outcome ==");
  lines.push(`  ${"Outcome".padEnd(24)} ${"#".padStart(5)}  ${"Total".padStart(12)}  ${"Avg".padStart(12)}`);
  for (const row of report.costPerOutcome) {
    lines.push(
      `  ${row.outcome.padEnd(24)} ${String(row.migrationCount).padStart(5)}  ${fmtUsd(row.totalCostUsd).padStart(12)}  ${fmtUsd(row.avgCostUsd).padStart(12)}`,
    );
  }
  lines.push("");

  // Panel C
  const roi = report.roi;
  lines.push("== Panel C — ROI vs hand-migration ==");
  lines.push(`  Pipeline spend (all-time):  ${fmtUsd(roi.pipelineCostUsd)}`);
  lines.push(`  Successful migrations:      ${roi.successfulMigrations}  (SHIP IT + FIX FIRST)`);
  lines.push(`  Human-hours saved:          ${roi.humanHoursSaved}  (= ${roi.successfulMigrations} × ${roi.humanHoursPerTest} h/test)`);
  lines.push(`  Human cost displaced:       ${fmtUsd(roi.humanCostUsd)}  (× $${roi.humanHourlyRateUsd}/h)`);
  lines.push(
    `  ROI multiplier:             ${roi.roiMultiplier === null ? "n/a (no pipeline spend)" : `${roi.roiMultiplier.toFixed(1)}×`}`,
  );
  lines.push("");
  lines.push(
    `  Configure via repo variable PWM_HUMAN_HOUR_COST_USD = $${roi.humanHourlyRateUsd} (currently ${roi.rateFromEnv ? "configured" : "default"}).`,
  );

  return lines.join("\n");
}

function main(): void {
  const args = parseCliArgs();
  const db = new MetricsDB(args.db);
  let report: CostReport;
  try {
    report = buildReport(db);
  } finally {
    db.close();
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderText(report)}\n`);
}

main();
