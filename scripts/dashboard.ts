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
    dailyBurn: buildDailyBurn(db),
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
