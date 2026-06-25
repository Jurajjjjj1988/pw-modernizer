#!/usr/bin/env tsx
/**
 * resolve-locator.ts — multi-candidate locator self-heal (BP5).
 *
 * Prior art (Stagehand observe-then-act, Healenium score-cap, Playwright
 * codegen priority): instead of betting on ONE guessed locator, emit several
 * ranked candidates and keep the FIRST that resolves UNIQUELY against the live
 * page. This turns a hard hallucination failure (getByLabel that doesn't exist)
 * into graceful degradation (fall through to getByPlaceholder / getByRole that
 * does) WITHOUT a Claude repair round-trip — the live page picks the winner.
 *
 * Candidates are ranked by Playwright's recommended priority
 * (role > label/placeholder/text > testid > css), so the first uniquely-
 * resolving one is also the most stable.
 *
 *   npx tsx scripts/resolve-locator.ts --url https://www.saucedemo.com \
 *     --candidates "getByLabel('Username');getByPlaceholder('Username');getByRole('textbox',{name:'Username'})"
 *
 * Prints the first uniquely-resolving candidate (exit 0), or exits 1 if none
 * resolves uniquely (0 or >1 matches for every candidate — a real grounding gap).
 */
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

export interface CandidateProbe {
  candidate: string;
  /** Element count on the live page: 0 = not-found, 1 = unique, >1 = ambiguous. */
  count: number;
}

/**
 * Pick the first candidate that resolves to EXACTLY one element. Pure (takes
 * probe results), so the selection rule is unit-tested without a browser.
 * Returns null when none is unique (every candidate is 0 or >1).
 */
export function pickFirstUnique(probes: CandidateProbe[]): CandidateProbe | null {
  return probes.find((p) => p.count === 1) ?? null;
}

/** Stable-priority rank of a locator expression (lower = preferred). Mirrors
 * Playwright's role > label/placeholder/text > testid > css ordering, used to
 * ORDER candidates before probing so ties favour the most robust locator. */
export function priorityRank(candidate: string): number {
  if (/getByRole\s*\(/.test(candidate)) return 0;
  if (/getByLabel\s*\(/.test(candidate)) return 1;
  if (/getByPlaceholder\s*\(/.test(candidate)) return 2;
  if (/getByText\s*\(/.test(candidate)) return 3;
  if (/getByTestId\s*\(/.test(candidate)) return 4;
  return 5; // css / locator()
}

/** Probe each candidate against the live page; return {candidate,count}. Lazy
 * import of playwright so the pure exports above stay browser-free for tests. */
async function probeCandidates(url: string, candidates: string[]): Promise<CandidateProbe[]> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const out: CandidateProbe[] = [];
    for (const candidate of candidates) {
      let count = -1;
      try {
        // The candidate is a `page.`-relative locator expression, e.g.
        // "getByRole('textbox',{name:'Username'})". Evaluate it against the page.
        const loc = new Function("page", `return page.${candidate};`)(page) as { count(): Promise<number> };
        count = await loc.count();
      } catch {
        count = -1; // unparseable / invalid locator
      }
      out.push({ candidate, count });
    }
    return out;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { url: { type: "string" }, candidates: { type: "string" } },
    strict: true,
  });
  if (!values.url || !values.candidates) {
    process.stderr.write("resolve-locator: --url <sut> and --candidates 'loc1;loc2;...' are required.\n");
    return 1;
  }
  const candidates = values.candidates.split(";").map((c) => c.trim()).filter(Boolean)
    .sort((a, b) => priorityRank(a) - priorityRank(b));
  const probes = await probeCandidates(values.url, candidates);
  for (const p of probes) {
    process.stderr.write(`  ${p.count === 1 ? "✓" : p.count === 0 ? "✗0" : p.count < 0 ? "ERR" : `✗${p.count}`} ${p.candidate}\n`);
  }
  const winner = pickFirstUnique(probes);
  if (!winner) {
    process.stderr.write("::error::resolve-locator: no candidate resolves uniquely — a real grounding gap (0 or >1 matches for all).\n");
    return 1;
  }
  process.stdout.write(`${winner.candidate}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => {
    process.stderr.write(`resolve-locator: ${String(e)}\n`);
    process.exit(1);
  });
}
