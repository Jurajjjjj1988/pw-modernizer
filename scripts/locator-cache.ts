#!/usr/bin/env tsx
/**
 * locator-cache.ts — per-app verified-locator manifest (IMP6).
 *
 * At scale you migrate a whole SUITE against ONE app. Today every test re-derives
 * the same locators from scratch and, when the model guesses wrong (getByLabel vs
 * getByPlaceholder), pays a repair round to fix it — over and over, per test. The
 * DOM-grounding probe already learns which locators resolve UNIQUELY against that
 * app's live DOM; persist those per host and feed them back as verified hints so
 * the 2nd…Nth test for the same app reuses the proven locator first-try (cheaper,
 * and consistent — the same element gets the same locator everywhere).
 *
 * The cache is keyed by URL host, holds only locators the live probe confirmed
 * `resolved-unique`, and is purely additive: a stale/missing entry just means the
 * model derives it as before. Never the source of truth — the live page is.
 *
 *   record:  npx tsx scripts/locator-cache.ts --record --url <u> --report <probe.json>
 *   hints:   npx tsx scripts/locator-cache.ts --hints  --url <u>
 *
 * Pure core (appKey / mergeEntries / renderCacheHints) is unit-tested.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CACHE_DIR = join(REPO_ROOT, "outputs/locator-cache");

export interface CacheEntry {
  /** The Playwright locator expression that resolved uniquely (e.g. `getByPlaceholder('Username')`). */
  locator: string;
  /** The live-DOM evidence from the probe (role/name/count), for the hint. */
  evidence: string;
}

/** One probed locator from a dom-ground report (the fields we consume). */
interface ProbedLocator {
  locator: string;
  domVerdict: string;
  domEvidence?: string;
  matches?: number;
}
interface ProbeReport {
  url?: string;
  results?: ProbedLocator[];
}

/** Cache key = the URL host (so all of saucedemo.com shares one manifest). */
export function appKey(url: string): string {
  try {
    return new URL(url).host || "unknown-host";
  } catch {
    return "unknown-host";
  }
}

function cacheFile(url: string): string {
  return join(CACHE_DIR, `${appKey(url).replace(/[^\w.-]/g, "_")}.json`);
}

/** Merge new verified entries into the existing set, deduped by locator (latest
 * evidence wins). Pure — easy to unit-test. */
export function mergeEntries(existing: CacheEntry[], incoming: CacheEntry[]): CacheEntry[] {
  const byLocator = new Map<string, CacheEntry>();
  for (const e of existing) byLocator.set(e.locator, e);
  for (const e of incoming) if (e.locator.trim().length > 0) byLocator.set(e.locator, e);
  return [...byLocator.values()].sort((a, b) => a.locator.localeCompare(b.locator));
}

/** Extract the `resolved-unique` locators from a dom-ground probe report. */
export function entriesFromReport(report: ProbeReport): CacheEntry[] {
  return (report.results ?? [])
    .filter((r) => r.domVerdict === "resolved-unique")
    .map((r) => ({ locator: r.locator, evidence: (r.domEvidence ?? "").slice(0, 120) }));
}

export function loadCache(url: string): CacheEntry[] {
  const f = cacheFile(url);
  if (!existsSync(f)) return [];
  try {
    const parsed = JSON.parse(readFileSync(f, "utf8")) as { entries?: CacheEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** Read a probe report + persist its resolved-unique locators to the host cache. */
export function recordFromReport(url: string, reportPath: string): number {
  if (!existsSync(reportPath)) return 0;
  let report: ProbeReport;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as ProbeReport;
  } catch {
    return 0;
  }
  const merged = mergeEntries(loadCache(url), entriesFromReport(report));
  const f = cacheFile(url);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify({ host: appKey(url), entries: merged }, null, 2)}\n`);
  return merged.length;
}

/** Render the cache as a prompt block of verified locators (or "" when empty).
 * Purely ADDITIVE info — it can only help the model pick the proven locator. */
export function renderCacheHints(entries: CacheEntry[], host: string): string {
  if (entries.length === 0) return "";
  const lines = entries.slice(0, 40).map((e) => `- \`${e.locator}\`${e.evidence ? `  // ${e.evidence}` : ""}`);
  return [
    `## VERIFIED LOCATORS for ${host} (resolved UNIQUELY against the live DOM in a prior migration)`,
    "Prefer these exact locators when the element matches — they are confirmed to work on this app.",
    "If an element here matches what you need, reuse the locator verbatim instead of guessing a new one.",
    "",
    ...lines,
  ].join("\n");
}

function main(): number {
  const { values } = parseArgs({
    options: {
      record: { type: "boolean", default: false },
      hints: { type: "boolean", default: false },
      url: { type: "string" },
      report: { type: "string" },
    },
    strict: true,
  });
  const url = values.url ?? "";
  if (!url) { process.stderr.write("locator-cache: --url <sut> required.\n"); return 1; }
  if (values.record) {
    if (!values.report) { process.stderr.write("locator-cache --record: --report <probe.json> required.\n"); return 1; }
    const n = recordFromReport(url, values.report);
    process.stdout.write(`locator-cache: ${appKey(url)} now holds ${n} verified locator(s).\n`);
    return 0;
  }
  if (values.hints) {
    process.stdout.write(renderCacheHints(loadCache(url), appKey(url)));
    return 0;
  }
  process.stderr.write("locator-cache: pass --record or --hints.\n");
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
