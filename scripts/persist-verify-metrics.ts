#!/usr/bin/env node
/**
 * persist-verify-metrics.ts — verify-stage metrics writer.
 *
 * Reads the verify report markdown, extracts the verdict line + counts
 * disagreement-table rows, and writes one row to the `verifications`
 * table via MetricsDB.recordVerification().
 *
 * Wired into verify.yml after "Verify report secret scan (mirror Stage 0)"
 * and before "Comment verify findings on code PR". The PR-comment step
 * already gates on report existence + verdict shape; we run after the secret
 * scan so a verdict change due to manual edits between scan and comment
 * still gets recorded.
 *
 * Usage:
 *   npx tsx scripts/persist-verify-metrics.ts --report <path>
 *
 * Env vars:
 *   METRICS_DB    optional, defaults to outputs/.metrics.db.
 *   GITHUB_SHA    optional, defaults to "local".
 *
 * Parsing rules:
 *   - Verdict: first `^- Verdict: <one of SHIP IT|FIX FIRST|START OVER>$`
 *     match (case-sensitive, matching verify.yml's existing parser).
 *   - Disagreement count: rows in the `## Disagreements` table whose first
 *     column is a numeric index. Header + separator lines are excluded.
 *
 * Strict TS, no any.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { MetricsDB, type Verdict } from "./metrics.js";

interface CliArgs {
  report: string;
}

const VERDICT_RE = /^- Verdict:\s+(SHIP IT|FIX FIRST|START OVER)\s*$/m;
const DISAGREEMENTS_SECTION_RE = /^## Disagreements\s*$/m;
const NEXT_SECTION_RE = /^## /m;
// A real disagreement row starts with `| <integer> |` — excludes header
// (`| # |`) and the `|---|` separator line.
const NUMERIC_ROW_RE = /^\|\s*\d+\s*\|/gm;

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      report: { type: "string" },
    },
  });
  if (typeof values.report !== "string" || values.report.length === 0) {
    throw new Error("--report is required");
  }
  return { report: values.report };
}

function extractVerdict(report: string): Verdict {
  const m = report.match(VERDICT_RE);
  if (m === null || m[1] === undefined) {
    throw new Error("verify report missing `- Verdict: <SHIP IT|FIX FIRST|START OVER>` line");
  }
  // Narrowed by regex; explicit cast keeps strict TS happy without `any`.
  return m[1] as Verdict;
}

function countDisagreementRows(report: string): number {
  const sectionMatch = DISAGREEMENTS_SECTION_RE.exec(report);
  if (sectionMatch === null) return 0;
  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  // Scan from after the header to the next `## ` heading (or EOF).
  const rest = report.slice(sectionStart);
  const nextHeaderMatch = NEXT_SECTION_RE.exec(rest);
  const sectionBody = nextHeaderMatch === null ? rest : rest.slice(0, nextHeaderMatch.index);
  const matches = sectionBody.match(NUMERIC_ROW_RE);
  return matches === null ? 0 : matches.length;
}

function inferInputBasename(reportPath: string): string {
  // Verify report filenames follow `<input-basename>-verify.md`. Strip the
  // suffix when present; otherwise use the bare filename. Stage 2's
  // metrics row uses just the input basename, so we mirror that here for
  // joinability across the migrations + verifications tables.
  const fn = basename(reportPath);
  return fn.endsWith("-verify.md") ? fn.slice(0, -"-verify.md".length) : fn;
}

function main(): void {
  const args = parseCliArgs();
  const report = readFileSync(args.report, "utf8");

  const verdict = extractVerdict(report);
  const disagreementCount = countDisagreementRows(report);
  const inputBasename = inferInputBasename(args.report);

  const dbPath = process.env["METRICS_DB"] ?? "outputs/.metrics.db";
  const commitSha = process.env["GITHUB_SHA"] ?? "local";

  const db = new MetricsDB(dbPath);
  try {
    db.recordVerification({
      input_basename: inputBasename,
      verdict,
      disagreement_count: disagreementCount,
      commit_sha: commitSha,
    });
  } finally {
    db.close();
  }
  process.stdout.write(
    `persist-verify-metrics: recorded ${inputBasename} — ${verdict} (${disagreementCount} disagreement(s))\n`,
  );
}

main();
