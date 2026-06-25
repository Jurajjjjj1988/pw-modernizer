#!/usr/bin/env tsx
/**
 * rag-ablation.ts — is RAG load-bearing or decorative? (audit: rag-decorative-unmeasured)
 *
 * STAGE1_RAG defaults OFF and no production A/B was ever recorded, so retrieval
 * value was UNMEASURED; the headline MAP@3=0.868 is also inflated because its
 * relevance counts a bare same-FRAMEWORK match (every doc is framework-tagged and
 * the query seeds the framework token, so BM25 trivially matches a framework
 * string to itself). This is an OFFLINE ablation that answers the load-bearing
 * question without a Claude run: does lexical retrieval surface a neighbour that
 * shares the query's anti-pattern KB-IDs (real, transferable signal) BETTER than
 * chance — and better than just returning a same-framework doc?
 *
 * For each plan (leave-one-out) we rank the other plans by token-Jaccard on the
 * plan body, take the top-1, and ask: does it share >=1 KB-ID with the query?
 *   - retrievalPrecision@1 : top lexical neighbour shares a KB-ID
 *   - frameworkBaseline    : a same-framework doc shares a KB-ID (the inflated signal)
 *   - chanceBaseline       : a uniformly-random other doc shares a KB-ID
 *   - lift = retrieval − chance  (informativeness BEYOND chance; <=0 ⇒ decorative)
 *
 *   npx tsx scripts/rag-ablation.ts [--index outputs/.rag-index.json] [--k 1]
 *
 * Always exits 0 (diagnostic). Pure core (ablate) is unit-tested.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export interface AblationDoc {
  id: string;
  framework: string;
  kbIds: string[];
  body: string;
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "page", "test", "plan"]);

export function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= 4 && !STOP.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const sharesKb = (a: AblationDoc, b: AblationDoc): boolean => a.kbIds.some((id) => b.kbIds.includes(id));

export interface Ablation {
  n: number;
  retrievalPrecision: number;
  frameworkBaseline: number;
  chanceBaseline: number;
  lift: number;
  verdict: "load-bearing" | "weak" | "decorative";
}

/**
 * Leave-one-out ablation. `pick` chooses the top-1 lexical neighbour; baselines
 * average over the deterministic candidate sets (no randomness — chanceBaseline
 * is the mean KB-share over ALL other docs, the expected value of a random pick).
 */
export function ablate(docs: AblationDoc[]): Ablation {
  const usable = docs.filter((d) => d.kbIds.length > 0);
  const n = usable.length;
  if (n < 2) return { n, retrievalPrecision: 0, frameworkBaseline: 0, chanceBaseline: 0, lift: 0, verdict: "decorative" };
  const toks = new Map(docs.map((d) => [d.id, tokenize(d.body)]));
  let retrievalHits = 0;
  let fwSum = 0;
  let chanceSum = 0;
  for (const q of usable) {
    const others = docs.filter((d) => d.id !== q.id);
    // top-1 lexical neighbour
    let best: AblationDoc | null = null;
    let bestSim = -1;
    for (const c of others) {
      const sim = jaccard(toks.get(q.id) ?? new Set(), toks.get(c.id) ?? new Set());
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (best && sharesKb(q, best)) retrievalHits += 1;
    // baselines: mean KB-share over the same-framework set, and over ALL others
    const sameFw = others.filter((d) => d.framework !== "unknown" && d.framework === q.framework);
    fwSum += sameFw.length > 0 ? sameFw.filter((d) => sharesKb(q, d)).length / sameFw.length : 0;
    chanceSum += others.filter((d) => sharesKb(q, d)).length / others.length;
  }
  const retrievalPrecision = retrievalHits / n;
  const frameworkBaseline = fwSum / n;
  const chanceBaseline = chanceSum / n;
  const lift = retrievalPrecision - chanceBaseline;
  const verdict = lift >= 0.2 ? "load-bearing" : lift > 0.05 ? "weak" : "decorative";
  return { n, retrievalPrecision, frameworkBaseline, chanceBaseline, lift, verdict };
}

// ---- I/O shell ----

function loadIndex(path: string): AblationDoc[] {
  if (!existsSync(path)) return [];
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const docs = (raw as { documents?: unknown[] }).documents ?? [];
  return docs.map((d) => {
    const o = d as { id?: string; sourceFramework?: string; kbIds?: string[]; planBody?: string };
    return {
      id: String(o.id ?? ""),
      framework: String(o.sourceFramework ?? "unknown"),
      kbIds: Array.isArray(o.kbIds) ? o.kbIds : [],
      body: String(o.planBody ?? ""),
    };
  });
}

function main(): void {
  const { values } = parseArgs({ options: { index: { type: "string", default: "outputs/.rag-index.json" } }, strict: true });
  const path = values.index ?? "outputs/.rag-index.json";
  const docs = loadIndex(path);
  if (docs.length === 0) {
    process.stdout.write(`rag-ablation: no index at ${path} (run npm run rag:index first).\n`);
    return;
  }
  const a = ablate(docs);
  const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
  process.stdout.write(
    `# RAG ablation — is retrieval load-bearing?\n\n` +
      `Corpus: ${docs.length} plans (${a.n} with KB-IDs).\n` +
      `  retrieval precision@1 (top lexical neighbour shares a KB-ID): ${pct(a.retrievalPrecision)}\n` +
      `  framework baseline    (a same-framework doc shares a KB-ID):  ${pct(a.frameworkBaseline)}  ← what MAP@3 over-credits\n` +
      `  chance baseline       (a random other doc shares a KB-ID):    ${pct(a.chanceBaseline)}\n` +
      `  LIFT over chance: ${(a.lift * 100).toFixed(0)} pts → **${a.verdict}**\n\n` +
      (a.verdict === "decorative"
        ? `Retrieval does not beat chance on KB-relevance — RAG is decorative here; do not gate on it until the corpus grows or retrieval improves.\n`
        : `Retrieval surfaces KB-relevant neighbours above chance — the load-bearing signal exists; worth an on/shadow A/B on plan quality next.\n`),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
