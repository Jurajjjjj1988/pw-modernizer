#!/usr/bin/env tsx
/**
 * measure-cache-hit-rate.ts — report Anthropic prompt-cache effectiveness.
 *
 * Why
 * ===
 * Once we route Claude calls through `scripts/claude-cached-call.ts`, every
 * call writes a usage JSON to `outputs/.usage/<basename>-<stage>[-<lens>].json`
 * with `cache_read_tokens` and `cache_creation_tokens` populated. This script
 * aggregates those files and answers:
 *
 *   - What's our cache HIT rate (cache_read / (cache_read + cache_creation))?
 *   - How many $ did caching save vs paying full input rate on every token?
 *   - Which stages benefit most?
 *
 * The same usage JSON shape is also written by the legacy CLI path via
 * `scripts/extract-claude-usage.ts` — those rows will have
 * `cache_read_tokens: 0` + `cache_creation_tokens: 0` (the CLI's automatic
 * cache happens server-side without exposing the buckets cleanly), so they
 * appear in the report as "untracked" and don't skew the hit-rate number.
 *
 * Usage
 * =====
 *   npm run cache:report                    # scan outputs/.usage/ in cwd
 *   tsx scripts/measure-cache-hit-rate.ts --dir <path>  # custom dir
 *   tsx scripts/measure-cache-hit-rate.ts --json        # machine-readable
 *
 * Strict TS, no `any`. Reads only — no DB writes.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { computeCostUsd, type UsageStats } from "./metrics.js";

interface UsageRow {
  file: string;
  /** Inferred from the filename: <basename>-<stage>[-<lens>].json. */
  stage: "plan" | "migrate" | "verify" | "verify-sdet" | "verify-code-review" | "unknown";
  basename: string;
  usage: UsageStats;
}

/**
 * Parse `<basename>-<stage>[-<lens>].json` filenames into a typed row.
 * Falls back to "unknown" stage if the filename doesn't match the pattern;
 * we still count it in totals but skip the per-stage breakdown.
 */
function classifyStage(file: string): UsageRow["stage"] {
  if (file.endsWith("-verify-sdet.json")) return "verify-sdet";
  if (file.endsWith("-verify-code-review.json")) return "verify-code-review";
  if (file.endsWith("-verify.json")) return "verify";
  if (file.endsWith("-migrate.json")) return "migrate";
  if (file.endsWith("-plan.json")) return "plan";
  return "unknown";
}

function inferBasename(file: string, stage: UsageRow["stage"]): string {
  const noExt = file.replace(/\.json$/, "");
  const suffixMap: Record<UsageRow["stage"], string> = {
    "verify-sdet": "-verify-sdet",
    "verify-code-review": "-verify-code-review",
    verify: "-verify",
    migrate: "-migrate",
    plan: "-plan",
    unknown: "",
  };
  const suffix = suffixMap[stage];
  return suffix.length > 0 && noExt.endsWith(suffix) ? noExt.slice(0, -suffix.length) : noExt;
}

function loadUsageDir(dir: string): UsageRow[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write(`::warning::usage dir not found: ${dir}\n`);
    return [];
  }
  const rows: UsageRow[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const full = join(dir, file);
    try {
      const raw: unknown = JSON.parse(readFileSync(full, "utf8"));
      if (typeof raw !== "object" || raw === null) continue;
      const obj = raw as Partial<UsageStats>;
      if (typeof obj.model !== "string" || typeof obj.input_tokens !== "number" || typeof obj.output_tokens !== "number") {
        continue;
      }
      const stage = classifyStage(file);
      rows.push({
        file,
        stage,
        basename: inferBasename(file, stage),
        usage: obj as UsageStats,
      });
    } catch {
      // Skip malformed JSON — same posture as persist-verify-metrics' loadUsage.
      continue;
    }
  }
  return rows;
}

interface StageStats {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  /** Sum of computeCostUsd over rows where we can price the model. */
  actual_cost_usd: number;
  /** What the cost WOULD be if we paid full input rate on cache_read_tokens. */
  no_cache_cost_usd: number;
}

function emptyStats(): StageStats {
  return {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    actual_cost_usd: 0,
    no_cache_cost_usd: 0,
  };
}

function aggregate(rows: UsageRow[]): { perStage: Map<UsageRow["stage"], StageStats>; total: StageStats } {
  const perStage = new Map<UsageRow["stage"], StageStats>();
  const total = emptyStats();
  for (const row of rows) {
    const s = perStage.get(row.stage) ?? emptyStats();
    s.calls += 1;
    s.input_tokens += row.usage.input_tokens;
    s.output_tokens += row.usage.output_tokens;
    s.cache_read_tokens += row.usage.cache_read_tokens ?? 0;
    s.cache_creation_tokens += row.usage.cache_creation_tokens ?? 0;

    const actual = computeCostUsd(row.usage) ?? 0;
    s.actual_cost_usd += actual;

    // "No-cache" hypothetical: cache_read would have been billed at input
    // rate, cache_creation would have been billed at input rate too (i.e.
    // no caching at all — re-send full prompt each call). We synthesise a
    // UsageStats with everything rolled into input_tokens and re-price.
    const synthetic: UsageStats = {
      model: row.usage.model,
      input_tokens:
        row.usage.input_tokens + (row.usage.cache_read_tokens ?? 0) + (row.usage.cache_creation_tokens ?? 0),
      output_tokens: row.usage.output_tokens,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    };
    s.no_cache_cost_usd += computeCostUsd(synthetic) ?? 0;

    perStage.set(row.stage, s);

    total.calls += 1;
    total.input_tokens += row.usage.input_tokens;
    total.output_tokens += row.usage.output_tokens;
    total.cache_read_tokens += row.usage.cache_read_tokens ?? 0;
    total.cache_creation_tokens += row.usage.cache_creation_tokens ?? 0;
    total.actual_cost_usd += actual;
    total.no_cache_cost_usd += computeCostUsd(synthetic) ?? 0;
  }
  return { perStage, total };
}

function hitRate(s: StageStats): number {
  const cachable = s.cache_read_tokens + s.cache_creation_tokens;
  return cachable === 0 ? 0 : s.cache_read_tokens / cachable;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function printText(perStage: Map<UsageRow["stage"], StageStats>, total: StageStats): void {
  process.stdout.write(`\n=== Anthropic prompt-cache hit-rate report ===\n\n`);
  if (total.calls === 0) {
    process.stdout.write(
      `No usage rows found. Run a stage that writes to outputs/.usage/ first\n` +
        `(e.g. trigger verify.yml or call scripts/claude-cached-call.ts).\n\n`,
    );
    return;
  }

  // Stage breakdown table
  const stages: UsageRow["stage"][] = [
    "plan",
    "migrate",
    "verify",
    "verify-sdet",
    "verify-code-review",
    "unknown",
  ];
  process.stdout.write(
    `${"Stage".padEnd(22)}  ${"calls".padStart(5)}  ${"in_tok".padStart(8)}  ${"out_tok".padStart(8)}  ${"cache_r".padStart(8)}  ${"cache_c".padStart(8)}  ${"hit%".padStart(6)}  ${"actual".padStart(9)}  ${"no-cache".padStart(9)}\n`,
  );
  for (const stage of stages) {
    const s = perStage.get(stage);
    if (!s || s.calls === 0) continue;
    const hr = (hitRate(s) * 100).toFixed(1);
    process.stdout.write(
      `${stage.padEnd(22)}  ${s.calls.toString().padStart(5)}  ${s.input_tokens.toString().padStart(8)}  ${s.output_tokens.toString().padStart(8)}  ${s.cache_read_tokens.toString().padStart(8)}  ${s.cache_creation_tokens.toString().padStart(8)}  ${hr.padStart(5)}%  ${fmtUsd(s.actual_cost_usd).padStart(9)}  ${fmtUsd(s.no_cache_cost_usd).padStart(9)}\n`,
    );
  }

  // Totals
  const hr = (hitRate(total) * 100).toFixed(1);
  process.stdout.write(
    `${"-".repeat(22)}  ${"-----".padStart(5)}  ${"--------".padStart(8)}  ${"--------".padStart(8)}  ${"--------".padStart(8)}  ${"--------".padStart(8)}  ${"------".padStart(6)}  ${"---------".padStart(9)}  ${"---------".padStart(9)}\n`,
  );
  process.stdout.write(
    `${"TOTAL".padEnd(22)}  ${total.calls.toString().padStart(5)}  ${total.input_tokens.toString().padStart(8)}  ${total.output_tokens.toString().padStart(8)}  ${total.cache_read_tokens.toString().padStart(8)}  ${total.cache_creation_tokens.toString().padStart(8)}  ${hr.padStart(5)}%  ${fmtUsd(total.actual_cost_usd).padStart(9)}  ${fmtUsd(total.no_cache_cost_usd).padStart(9)}\n\n`,
  );

  const saved = total.no_cache_cost_usd - total.actual_cost_usd;
  const pct = total.no_cache_cost_usd > 0 ? (saved / total.no_cache_cost_usd) * 100 : 0;
  process.stdout.write(`Estimated savings from caching: ${fmtUsd(saved)} (${pct.toFixed(1)}% of no-cache baseline)\n`);
  process.stdout.write(
    `Note: rows with cache_read_tokens=0 AND cache_creation_tokens=0 are either\n` +
      `legacy CLI rows (caching is server-side, opaque) or first-cold calls. These\n` +
      `appear in totals but don't contribute to the hit rate's numerator OR\n` +
      `denominator.\n\n`,
  );
}

function printJson(perStage: Map<UsageRow["stage"], StageStats>, total: StageStats): void {
  const out: Record<string, unknown> = {
    total: { ...total, hit_rate: hitRate(total) },
    per_stage: Object.fromEntries(
      Array.from(perStage.entries()).map(([k, v]) => [k, { ...v, hit_rate: hitRate(v) }]),
    ),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

function main(): number {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const dir = typeof values.dir === "string" && values.dir.length > 0
    ? resolve(values.dir)
    : resolve(process.cwd(), "outputs/.usage");

  const rows = loadUsageDir(dir);
  const { perStage, total } = aggregate(rows);

  if (values.json === true) {
    printJson(perStage, total);
  } else {
    printText(perStage, total);
  }
  return 0;
}

process.exit(main());
