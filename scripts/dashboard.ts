#!/usr/bin/env node
/**
 * dashboard.ts — minimal read-only web UI for the metrics SQLite cache.
 *
 * v1.0 ROADMAP "Metrics dashboard" — long-form web counterpart to the
 * text-mode `metrics-report.ts` and JSON-export `metrics-export.ts`. Reads
 * the same DB the Stage 1 / Stage 2 / verify writers populate (default
 * `outputs/.metrics.db`) and serves it over Node's built-in http module —
 * no Express, no extra deps. Aggregate shape mirrors `metrics-export.ts`
 * so the HTML shell could swap a checked-in JSON artifact for the live
 * /api/data endpoint without changing the Chart.js bindings.
 *
 * Usage:
 *   npx tsx scripts/dashboard.ts [--port 8000] [--db outputs/.metrics.db]
 *
 * Routes:
 *   GET /          → HTML page (Chart.js + Tailwind from CDN)
 *   GET /api/data  → JSON aggregates (live read from SQLite)
 *
 * Strict TS, no any. Each request opens the DB synchronously and closes
 * it before responding (matches persist-plan-metrics.ts pattern); the WAL
 * journal means workflow writers are never blocked by a dashboard read.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MetricsDB, normalizeSourceFramework, type QueryRow, type SourceFramework } from "./metrics.js";

interface CliArgs {
  port: number;
  db: string;
  /**
   * When set, render ONE self-contained `index.html` (data inlined) into the
   * named directory and exit instead of starting the HTTP server. Used by the
   * `dashboard-deploy.yml` workflow to publish to GitHub Pages — Pages serves
   * static files only, so the runtime `/api/data` endpoint can't ship.
   */
  staticOutDir: string | null;
}

interface FrameworkAgg {
  framework: string;
  count: number;
  avgAggregateConfidence: number;
  avgSmellRemovalRate: number;
}

interface KbCitation {
  kbId: string;
  count: number;
}

interface VerdictAgg {
  verdict: string;
  count: number;
  pct: number;
}

interface TrendPoint {
  createdAtUnix: number;
  aggregateConfidence: number;
  inputBasename: string;
}

/** Stacked-bar source — counts of each verdict per framework. */
interface VerdictByFrameworkRow {
  framework: SourceFramework;
  shipIt: number;
  fixFirst: number;
  startOver: number;
}

/** One line on the multi-line confidence chart — sample is oldest→newest. */
interface FrameworkTrendSeries {
  framework: SourceFramework;
  points: TrendPoint[];
}

/** "Which framework Migrator handles best/worst" — sorted table row. */
interface FrameworkQualityRow {
  framework: SourceFramework;
  migrationCount: number;
  verificationCount: number;
  medianConfidence: number;
  meanConfidence: number;
  shipItRate: number;
  fixFirstRate: number;
  startOverRate: number;
}

/** One row of the per-PR cost table. Untracked rows have cost_usd null. */
interface CostPerRunRow {
  createdAtUnix: number;
  stage: "plan" | "migration" | "verification";
  inputBasename: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  costUsd: number | null;
}

/** One bar of the daily-burn-rate chart. */
interface DailyBurnRow {
  date: string;            // YYYY-MM-DD (UTC)
  costUsd: number;         // sum across all stages for that day
  trackedRunCount: number; // number of rows with cost_usd NOT NULL
}

/**
 * Panel A — "Cost this week". Big number on top + per-stage breakdown for
 * the last 7 UTC days, plus a 30-day daily sparkline. `deltaPct` is the
 * percent change vs the previous 7-day window (negative = cheaper than
 * last week). `null` when the previous window has zero spend (can't divide).
 */
interface WeeklyCostPanel {
  /** Sum of cost_usd across last 7 calendar days (UTC), all stages. */
  totalLast7DaysUsd: number;
  /** Sum of cost_usd across the prior 7 calendar days (days [-13, -7] from today). */
  totalPrev7DaysUsd: number;
  /** (last - prev) / prev. null when prev is zero. */
  deltaPct: number | null;
  /** Per-stage breakdown of the last 7 days. */
  byStage: Array<{ stage: "plan" | "migration" | "verification"; costUsd: number }>;
  /** 30-day daily series (oldest → newest, gaps filled with 0) for the sparkline. */
  sparkline: Array<{ date: string; costUsd: number }>;
  /** Migrations completed in the last 7 days. Drives the human-hours saved math. */
  migrationsLast7Days: number;
}

/**
 * Panel B — "Cost per outcome". Average $ spent per migration grouped by
 * verdict bucket. `BLOCKED-BY-VALIDATOR` is synthetic — input_basenames that
 * incurred plan/migrate cost but never produced a verification row (Stage 2
 * gates blocked them before Opus Verify could fire).
 */
interface CostPerOutcomeRow {
  outcome: "SHIP IT" | "FIX FIRST" | "START OVER" | "BLOCKED-BY-VALIDATOR";
  /** Number of distinct input_basenames bucketed here. */
  migrationCount: number;
  /** Total cost across all stages for these input_basenames. */
  totalCostUsd: number;
  /** totalCostUsd / migrationCount; 0 when migrationCount === 0. */
  avgCostUsd: number;
}

/**
 * Panel C — "ROI vs hand-migration". `humanHoursPerTest` × `humanHourlyRateUsd`
 * × `successfulMigrations` is the displaced human cost. `successfulMigrations`
 * counts SHIP IT + FIX FIRST verdicts — START OVER and BLOCKED don't count as
 * value delivered. `humanHourlyRateUsd` overridable via repo var
 * `PWM_HUMAN_HOUR_COST_USD`. `roiMultiplier` is humanCost / pipelineCost; null
 * when pipelineCost is 0.
 */
interface RoiPanel {
  /** All-time pipeline spend (tracked rows only). */
  pipelineCostUsd: number;
  /** SHIP IT + FIX FIRST verification count. */
  successfulMigrations: number;
  /** Configurable; default 4. */
  humanHoursPerTest: number;
  /** Configurable via PWM_HUMAN_HOUR_COST_USD env var; default 80. */
  humanHourlyRateUsd: number;
  /** Human-hours of work displaced — successfulMigrations × humanHoursPerTest. */
  humanHoursSaved: number;
  /** Dollar value of displaced human work. */
  humanCostUsd: number;
  /** humanCostUsd / pipelineCostUsd. null when pipelineCostUsd is 0. */
  roiMultiplier: number | null;
  /** True when PWM_HUMAN_HOUR_COST_USD was read from env (vs default). */
  rateFromEnv: boolean;
}

/** Top-level cost rollup shown above the per-run table. */
interface CostSummary {
  trackedRuns: number;
  untrackedRuns: number;
  totalCostUsd: number;
  byModel: Array<{ model: string; runs: number; costUsd: number; tokensIn: number; tokensOut: number }>;
}

interface DashboardData {
  generatedAtUnix: number;
  summary: {
    totalMigrations: number;
    totalPlans: number;
    totalVerifications: number;
    earliestUnix: number | null;
    latestUnix: number | null;
  };
  perFramework: FrameworkAgg[];
  topKbIds: KbCitation[];
  verdicts: VerdictAgg[];
  confidenceTrend: TrendPoint[];
  /** Stacked-bar: verdict counts per framework (joined via input_basename). */
  verdictByFramework: VerdictByFrameworkRow[];
  /** Multi-line: last-N confidence points, grouped by framework. */
  confidenceTrendByFramework: FrameworkTrendSeries[];
  /** Sorted DESC by medianConfidence — answers "best/worst framework". */
  frameworkQuality: FrameworkQualityRow[];
  /** Top-line cost rollup — total spend, runs tracked vs untracked, per-model split. */
  costSummary: CostSummary;
  /** Last 50 runs across all stages, newest first. Untracked runs surface as cost_usd=null. */
  costPerRun: CostPerRunRow[];
  /** Daily aggregated cost for the last 30 calendar days (UTC). */
  dailyBurn: DailyBurnRow[];
  /** Panel A — "Cost this week" (last 7 days + per-stage + 30-day sparkline). */
  weeklyCost: WeeklyCostPanel;
  /** Panel B — "Cost per outcome" (avg $ per migration by verdict bucket). */
  costPerOutcome: CostPerOutcomeRow[];
  /** Panel C — "ROI vs hand-migration". */
  roi: RoiPanel;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "8000" },
      db: { type: "string", default: "outputs/.metrics.db" },
      static: { type: "string" },
    },
  });
  const portStr = typeof values.port === "string" ? values.port : "8000";
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`--port must be a valid TCP port, got "${portStr}"`);
  }
  const staticOutDir = typeof values.static === "string" && values.static.length > 0 ? values.static : null;
  return {
    port,
    db: typeof values.db === "string" ? values.db : "outputs/.metrics.db",
    staticOutDir,
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

interface FrameworkVerdictTally {
  shipIt: number;
  fixFirst: number;
  startOver: number;
}

/**
 * Verdict counts grouped by framework. The `verifications` table doesn't
 * carry source_framework (kept normalized — see metrics.ts schema), so we
 * LEFT JOIN against `migrations` via input_basename. A verification for an
 * input that was never recorded as a migration gets bucketed under
 * "unknown" — matches normalizeSourceFramework() fallback.
 */
function buildVerdictByFramework(db: MetricsDB): VerdictByFrameworkRow[] {
  const rows = db.query(
    `SELECT COALESCE(m.source_framework, 'unknown') AS framework,
            v.verdict AS verdict,
            COUNT(*) AS count
     FROM verifications v
     LEFT JOIN migrations m ON m.input_basename = v.input_basename
     GROUP BY framework, verdict`,
  );
  const tally = new Map<SourceFramework, FrameworkVerdictTally>();
  for (const r of rows) {
    const fw = normalizeSourceFramework(str(r, "framework"));
    const verdict = str(r, "verdict");
    const c = num(r, "count");
    const existing = tally.get(fw) ?? { shipIt: 0, fixFirst: 0, startOver: 0 };
    if (verdict === "SHIP IT") existing.shipIt += c;
    else if (verdict === "FIX FIRST") existing.fixFirst += c;
    else if (verdict === "START OVER") existing.startOver += c;
    tally.set(fw, existing);
  }
  return Array.from(tally.entries())
    .map(([framework, t]) => ({ framework, ...t }))
    .sort((a, b) => b.shipIt + b.fixFirst + b.startOver - (a.shipIt + a.fixFirst + a.startOver));
}

/**
 * Multi-line confidence trend, last 30 migrations per framework. We pull a
 * generous LIMIT (30 * 5 buckets = 150) then trim each bucket client-side so
 * each line has at most 30 oldest→newest points — avoids fighting LIMIT
 * with a partition window which SQLite doesn't have without CTE gymnastics.
 */
function buildConfidenceTrendByFramework(db: MetricsDB): FrameworkTrendSeries[] {
  const rows = db.query(
    `SELECT created_at, aggregate_confidence, input_basename, source_framework
     FROM migrations
     ORDER BY created_at DESC
     LIMIT 150`,
  );
  const buckets = new Map<SourceFramework, TrendPoint[]>();
  for (const r of rows) {
    const fw = normalizeSourceFramework(str(r, "source_framework"));
    const existing = buckets.get(fw) ?? [];
    if (existing.length >= 30) continue;
    existing.push({
      createdAtUnix: num(r, "created_at"),
      aggregateConfidence: num(r, "aggregate_confidence"),
      inputBasename: str(r, "input_basename"),
    });
    buckets.set(fw, existing);
  }
  // Bucket arrays are DESC by created_at — reverse to oldest→newest for the
  // Chart.js x-axis. Frameworks with zero rows are omitted (no line drawn).
  return Array.from(buckets.entries())
    .map(([framework, points]) => {
      // Bucket arrays come in DESC; reverse to oldest→newest for the chart.
      const oldestToNewest = [...points].reverse();
      return { framework, points: oldestToNewest };
    })
    .sort((a, b) => b.points.length - a.points.length);
}

/**
 * "Which framework Migrator handles best/worst" — per-framework median
 * confidence + SHIP IT rate, sorted DESC by median. Median (not mean) is
 * the headline metric because a single low-confidence outlier shouldn't
 * tank a framework that's otherwise consistent.
 */
function buildFrameworkQuality(db: MetricsDB): FrameworkQualityRow[] {
  // Per-framework confidence samples (for median).
  const confRows = db.query(
    `SELECT source_framework, aggregate_confidence FROM migrations`,
  );
  const confByFw = new Map<SourceFramework, number[]>();
  for (const r of confRows) {
    const fw = normalizeSourceFramework(str(r, "source_framework"));
    const samples = confByFw.get(fw) ?? [];
    samples.push(num(r, "aggregate_confidence"));
    confByFw.set(fw, samples);
  }

  // Per-framework verdict counts (joined the same way as verdictByFramework).
  const verdictRows = db.query(
    `SELECT COALESCE(m.source_framework, 'unknown') AS framework,
            v.verdict AS verdict,
            COUNT(*) AS count
     FROM verifications v
     LEFT JOIN migrations m ON m.input_basename = v.input_basename
     GROUP BY framework, verdict`,
  );
  const verdictByFw = new Map<SourceFramework, FrameworkVerdictTally>();
  for (const r of verdictRows) {
    const fw = normalizeSourceFramework(str(r, "framework"));
    const verdict = str(r, "verdict");
    const c = num(r, "count");
    const t = verdictByFw.get(fw) ?? { shipIt: 0, fixFirst: 0, startOver: 0 };
    if (verdict === "SHIP IT") t.shipIt += c;
    else if (verdict === "FIX FIRST") t.fixFirst += c;
    else if (verdict === "START OVER") t.startOver += c;
    verdictByFw.set(fw, t);
  }

  const allFrameworks = new Set<SourceFramework>([...confByFw.keys(), ...verdictByFw.keys()]);
  const rows: FrameworkQualityRow[] = [];
  for (const fw of allFrameworks) {
    const samples = confByFw.get(fw) ?? [];
    const verdicts = verdictByFw.get(fw) ?? { shipIt: 0, fixFirst: 0, startOver: 0 };
    const totalVerdicts = verdicts.shipIt + verdicts.fixFirst + verdicts.startOver;
    const meanConfidence = samples.length === 0
      ? 0
      : samples.reduce((a, b) => a + b, 0) / samples.length;
    rows.push({
      framework: fw,
      migrationCount: samples.length,
      verificationCount: totalVerdicts,
      medianConfidence: median(samples),
      meanConfidence,
      shipItRate: totalVerdicts === 0 ? 0 : verdicts.shipIt / totalVerdicts,
      fixFirstRate: totalVerdicts === 0 ? 0 : verdicts.fixFirst / totalVerdicts,
      startOverRate: totalVerdicts === 0 ? 0 : verdicts.startOver / totalVerdicts,
    });
  }
  return rows.sort((a, b) => b.medianConfidence - a.medianConfidence);
}

/**
 * Cost rollups. SELECT from migrations + plans + verifications via UNION
 * because token columns are mirrored across the 3 stage tables. Untracked
 * rows (cost_usd IS NULL) are surfaced separately so dashboard can show
 * "X runs, Y tracked, Z untracked" honestly — never silently treat NULL as 0.
 */
function buildCostSummary(db: MetricsDB): CostSummary {
  const totals = db.query(
    `SELECT
       SUM(CASE WHEN cost_usd IS NULL THEN 0 ELSE 1 END) AS tracked,
       SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS untracked,
       COALESCE(SUM(cost_usd), 0) AS total_cost
     FROM (
       SELECT cost_usd FROM migrations
       UNION ALL SELECT cost_usd FROM plans
       UNION ALL SELECT cost_usd FROM verifications
     )`,
  )[0] ?? {};

  const byModelRows = db.query(
    `SELECT model,
            COUNT(*) AS runs,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(input_tokens), 0) AS tokens_in,
            COALESCE(SUM(output_tokens), 0) AS tokens_out
     FROM (
       SELECT model, cost_usd, input_tokens, output_tokens FROM migrations WHERE model IS NOT NULL
       UNION ALL SELECT model, cost_usd, input_tokens, output_tokens FROM plans WHERE model IS NOT NULL
       UNION ALL SELECT model, cost_usd, input_tokens, output_tokens FROM verifications WHERE model IS NOT NULL
     )
     GROUP BY model
     ORDER BY cost_usd DESC`,
  );

  return {
    trackedRuns: num(totals, "tracked"),
    untrackedRuns: num(totals, "untracked"),
    totalCostUsd: num(totals, "total_cost"),
    byModel: byModelRows.map((r) => ({
      model: str(r, "model"),
      runs: num(r, "runs"),
      costUsd: num(r, "cost_usd"),
      tokensIn: num(r, "tokens_in"),
      tokensOut: num(r, "tokens_out"),
    })),
  };
}

function buildCostPerRun(db: MetricsDB): CostPerRunRow[] {
  const rows = db.query(
    `SELECT created_at, stage, input_basename, model,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd
     FROM (
       SELECT created_at, 'migration' AS stage, input_basename, model,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd
         FROM migrations
       UNION ALL
       SELECT created_at, 'plan' AS stage, input_basename, model,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd
         FROM plans
       UNION ALL
       SELECT created_at, 'verification' AS stage, input_basename, model,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd
         FROM verifications
     )
     ORDER BY created_at DESC
     LIMIT 50`,
  );
  return rows.map((r) => {
    const stageRaw = str(r, "stage");
    const stage: CostPerRunRow["stage"] =
      stageRaw === "plan" || stageRaw === "migration" || stageRaw === "verification" ? stageRaw : "migration";
    return {
      createdAtUnix: num(r, "created_at"),
      stage,
      inputBasename: str(r, "input_basename"),
      model: r["model"] === null ? null : str(r, "model"),
      inputTokens: r["input_tokens"] === null ? null : num(r, "input_tokens"),
      outputTokens: r["output_tokens"] === null ? null : num(r, "output_tokens"),
      cacheReadTokens: r["cache_read_tokens"] === null ? null : num(r, "cache_read_tokens"),
      cacheCreationTokens: r["cache_creation_tokens"] === null ? null : num(r, "cache_creation_tokens"),
      costUsd: r["cost_usd"] === null ? null : num(r, "cost_usd"),
    };
  });
}

function buildDailyBurn(db: MetricsDB): DailyBurnRow[] {
  // SQLite stores created_at as Unix seconds. strftime('%Y-%m-%d', created_at, 'unixepoch')
  // bins to UTC day. We cap at 30 most recent calendar days.
  const rows = db.query(
    `SELECT date,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            SUM(CASE WHEN cost_usd IS NULL THEN 0 ELSE 1 END) AS tracked_runs
     FROM (
       SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS date, cost_usd FROM migrations
       UNION ALL
       SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS date, cost_usd FROM plans
       UNION ALL
       SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS date, cost_usd FROM verifications
     )
     GROUP BY date
     ORDER BY date DESC
     LIMIT 30`,
  );
  // Reverse so charts display oldest→newest left-to-right.
  return rows
    .map((r) => ({
      date: str(r, "date"),
      costUsd: num(r, "cost_usd"),
      trackedRunCount: num(r, "tracked_runs"),
    }))
    .reverse();
}

/**
 * Default human-effort assumptions for ROI math. Both overridable —
 * `PWM_HUMAN_HOUR_COST_USD` from env, hours-per-test defaults to 4
 * (one bad-Playwright test rewritten cleanly: read → port locators →
 * verify → debug Sonnet-equivalent quality). Operators tune to their
 * actual baseline; the dashboard renders the assumption next to the
 * number so the ROI is honest, not magical.
 */
const ROI_DEFAULT_HOURS_PER_TEST = 4;
const ROI_DEFAULT_HOURLY_RATE_USD = 80;

/** Read the human-hour cost from env. Falls back to the default when unset
 *  or unparseable; the `rateFromEnv` flag in the returned panel lets the UI
 *  show "default" vs "configured" instead of silently lying. */
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

const SECONDS_PER_DAY = 86_400;

/**
 * Panel A builder. Sums cost across the 3 stage tables within rolling 7-day
 * windows. Uses Unix-second arithmetic against `created_at` (the DB stores
 * seconds since epoch) — simpler than strftime + date math here.
 *
 * Stage breakdown is for the LAST 7 days only — operators want "what did
 * this week cost", not all-time. The 30-day sparkline reuses the existing
 * `dailyBurn` query but fills missing days with 0 so the bar chart doesn't
 * skip days with no spend.
 */
function buildWeeklyCost(db: MetricsDB, dailyBurn: DailyBurnRow[]): WeeklyCostPanel {
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

  // Sparkline — fill the last 30 calendar days with 0s where dailyBurn has
  // no row so Chart.js draws a flat baseline instead of jumping between
  // distant dates.
  const burnMap = new Map<string, number>();
  for (const b of dailyBurn) burnMap.set(b.date, b.costUsd);
  const sparkline: Array<{ date: string; costUsd: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const ts = nowUnix - i * SECONDS_PER_DAY;
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    sparkline.push({ date, costUsd: burnMap.get(date) ?? 0 });
  }

  return {
    totalLast7DaysUsd: totalLast,
    totalPrev7DaysUsd: totalPrev,
    deltaPct,
    byStage: [
      { stage: "plan", costUsd: num(planSum, "total") },
      { stage: "migration", costUsd: num(migrationSum, "total") },
      { stage: "verification", costUsd: num(verificationSum, "total") },
    ],
    sparkline,
    migrationsLast7Days: num(migrationsCountRow, "count"),
  };
}

/**
 * Panel B builder. For each input_basename, attribute the latest verdict
 * (verifications table) and sum its total cost across plan + migrate +
 * verify. Inputs that never reached verify get bucketed as
 * `BLOCKED-BY-VALIDATOR` — they incurred plan/migrate spend but stage 2
 * validators blocked them before Opus Verify ran.
 *
 * "Latest verdict" — we use MAX(created_at) per input_basename in case a
 * verification was re-run. Earlier rows are not double-counted; the cost
 * SUM is per-basename, the verdict is per-basename.
 */
function buildCostPerOutcome(db: MetricsDB): CostPerOutcomeRow[] {
  // Sum cost per input_basename across all stages.
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

  // Latest verdict per input_basename. SQLite has no DISTINCT ON, so we
  // pull all rows and reduce in JS — cheaper than a correlated subquery
  // for the small N this dashboard reads.
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

  // Bucket-wise totals.
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

/**
 * Panel C builder. ROI = (humanHoursSaved × humanHourlyRate) / pipelineCost.
 *
 * `successfulMigrations` counts verifications with SHIP IT or FIX FIRST —
 * START OVER means re-roll, no value delivered. Distinct input_basenames so
 * a re-verified test isn't double-counted.
 */
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

function buildData(db: MetricsDB): DashboardData {
  const summaryRow = db.query(
    `SELECT
       (SELECT COUNT(*) FROM migrations) AS migrations,
       (SELECT COUNT(*) FROM plans) AS plans,
       (SELECT COUNT(*) FROM verifications) AS verifications,
       (SELECT MIN(created_at) FROM migrations) AS earliest,
       (SELECT MAX(created_at) FROM migrations) AS latest`,
  )[0] ?? {};

  const frameworkRows = db.query(
    `SELECT source_framework, COUNT(*) AS count,
            AVG(aggregate_confidence) AS avg_conf,
            AVG(smell_removal_rate) AS avg_smell
     FROM migrations
     GROUP BY source_framework
     ORDER BY count DESC`,
  );

  const planKbRows = db.query(`SELECT kb_ids_cited FROM plans`);
  const kbCounts = new Map<string, number>();
  for (const row of planKbRows) {
    const raw = str(row, "kb_ids_cited");
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const kbId of parsed) {
        if (typeof kbId !== "string") continue;
        kbCounts.set(kbId, (kbCounts.get(kbId) ?? 0) + 1);
      }
    } catch {
      // Skip malformed rows — DB is a reporting cache, not a source of truth.
    }
  }
  const topKbIds: KbCitation[] = Array.from(kbCounts.entries())
    .map(([kbId, count]) => ({ kbId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const verdictRows = db.query(
    `SELECT verdict, COUNT(*) AS count FROM verifications GROUP BY verdict`,
  );
  const verdictTotal = verdictRows.reduce((acc, r) => acc + num(r, "count"), 0);
  const verdicts: VerdictAgg[] = verdictRows.map((r) => ({
    verdict: str(r, "verdict"),
    count: num(r, "count"),
    pct: verdictTotal === 0 ? 0 : (num(r, "count") / verdictTotal) * 100,
  }));

  const trendRows = db.query(
    `SELECT created_at, aggregate_confidence, input_basename FROM migrations
     ORDER BY created_at DESC
     LIMIT 30`,
  );
  const confidenceTrend: TrendPoint[] = trendRows
    .map((r) => ({
      createdAtUnix: num(r, "created_at"),
      aggregateConfidence: num(r, "aggregate_confidence"),
      inputBasename: str(r, "input_basename"),
    }))
    .reverse();

  // Computed once and reused — `weeklyCost` fills its 30-day sparkline from
  // the same series the standalone "Daily burn rate" panel uses.
  const dailyBurnRows = buildDailyBurn(db);

  return {
    generatedAtUnix: Math.floor(Date.now() / 1000),
    summary: {
      totalMigrations: num(summaryRow, "migrations"),
      totalPlans: num(summaryRow, "plans"),
      totalVerifications: num(summaryRow, "verifications"),
      earliestUnix: num(summaryRow, "earliest") || null,
      latestUnix: num(summaryRow, "latest") || null,
    },
    perFramework: frameworkRows.map((r) => ({
      framework: normalizeSourceFramework(str(r, "source_framework")),
      count: num(r, "count"),
      avgAggregateConfidence: num(r, "avg_conf"),
      avgSmellRemovalRate: num(r, "avg_smell"),
    })),
    topKbIds,
    verdicts,
    confidenceTrend,
    verdictByFramework: buildVerdictByFramework(db),
    confidenceTrendByFramework: buildConfidenceTrendByFramework(db),
    frameworkQuality: buildFrameworkQuality(db),
    costSummary: buildCostSummary(db),
    costPerRun: buildCostPerRun(db),
    dailyBurn: dailyBurnRows,
    weeklyCost: buildWeeklyCost(db, dailyBurnRows),
    costPerOutcome: buildCostPerOutcome(db),
    roi: buildRoi(db),
  };
}

function readData(dbPath: string): DashboardData {
  const db = new MetricsDB(dbPath);
  try {
    return buildData(db);
  } finally {
    db.close();
  }
}

const HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "dashboard.html");
// Read once at startup — HTML shell is static; data flows in via /api/data.
const HTML_CACHE = readFileSync(HTML_PATH, "utf8");

function handleRequest(dbPath: string, req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("method not allowed");
    return;
  }
  try {
    if (url === "/" || url.startsWith("/?")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(HTML_CACHE);
      return;
    }
    if (url === "/api/data") {
      const data = readData(dbPath);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`dashboard error: ${msg}`);
  }
}

/**
 * Inline the aggregate JSON into the HTML shell so the rendered page works
 * without an HTTP server. Two surgical patches:
 *
 *   1. Inject a `<script>window.__DASHBOARD_DATA__ = {...}</script>` just
 *      before the existing IIFE.
 *   2. Replace the `fetch('/api/data') + res.json()` lines in the IIFE with
 *      a sync read from the injected global.
 *
 * `</` inside JSON strings is escaped to `<\/` so a malicious model name or
 * input basename can't break out of the script tag. JSON.stringify itself
 * doesn't escape `</script>` — we do it post-hoc.
 */
function renderStaticHtml(shell: string, data: DashboardData): string {
  const safeJson = JSON.stringify(data).replaceAll("</", String.raw`<\/`);
  const dataScript = `<script>window.__DASHBOARD_DATA__ = ${safeJson};</script>\n`;
  // The IIFE is identified by its opening line. Insert the data script
  // immediately before it so the global is set before the IIFE reads it.
  const iifeMarker = "<script>\n(async () => {";
  if (!shell.includes(iifeMarker)) {
    throw new Error(
      `dashboard.html shape changed — static mode can't find the IIFE marker '${iifeMarker}'. ` +
        `Update renderStaticHtml() to match the new template.`,
    );
  }
  let patched = shell.replace(iifeMarker, `${dataScript}${iifeMarker}`);
  // Replace the live fetch with a sync read from the injected global. Keep
  // the surrounding `const data = ...` shape so the rest of the IIFE is
  // unchanged.
  const fetchBlock =
    "  const res = await fetch('/api/data');\n  const data = await res.json();";
  const inlineBlock = "  const data = window.__DASHBOARD_DATA__;";
  if (!patched.includes(fetchBlock)) {
    throw new Error(
      "dashboard.html shape changed — static mode can't find the fetch('/api/data') block. " +
        "Update renderStaticHtml() to match the new template.",
    );
  }
  patched = patched.replace(fetchBlock, inlineBlock);
  return patched;
}

function runStatic(args: CliArgs, outDir: string): void {
  const data = readData(args.db);
  const html = renderStaticHtml(HTML_CACHE, data);
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "index.html");
  writeFileSync(outPath, html, "utf8");
  process.stdout.write(`Static dashboard written to ${outPath}\n`);
  process.stdout.write(`  reading DB: ${args.db}\n`);
}

function main(): void {
  const args = parseCliArgs();
  if (args.staticOutDir !== null) {
    runStatic(args, args.staticOutDir);
    return;
  }
  const server = createServer((req, res) => {
    handleRequest(args.db, req, res);
  });
  server.listen(args.port, () => {
    process.stdout.write(`Dashboard running at http://localhost:${args.port}\n`);
    process.stdout.write(`  reading DB: ${args.db}\n`);
  });
}

main();
