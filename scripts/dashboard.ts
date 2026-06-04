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

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MetricsDB, type QueryRow } from "./metrics.js";

interface CliArgs {
  port: number;
  db: string;
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
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "8000" },
      db: { type: "string", default: "outputs/.metrics.db" },
    },
  });
  const portStr = typeof values.port === "string" ? values.port : "8000";
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`--port must be a valid TCP port, got "${portStr}"`);
  }
  return {
    port,
    db: typeof values.db === "string" ? values.db : "outputs/.metrics.db",
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
      framework: str(r, "source_framework"),
      count: num(r, "count"),
      avgAggregateConfidence: num(r, "avg_conf"),
      avgSmellRemovalRate: num(r, "avg_smell"),
    })),
    topKbIds,
    verdicts,
    confidenceTrend,
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

function main(): void {
  const args = parseCliArgs();
  const server = createServer((req, res) => {
    handleRequest(args.db, req, res);
  });
  server.listen(args.port, () => {
    process.stdout.write(`Dashboard running at http://localhost:${args.port}\n`);
    process.stdout.write(`  reading DB: ${args.db}\n`);
  });
}

main();
