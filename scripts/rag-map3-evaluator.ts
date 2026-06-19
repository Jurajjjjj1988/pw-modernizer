#!/usr/bin/env node
/**
 * rag-map3-evaluator.ts - leave-one-out MAP@3 evaluation over the golden
 * example corpus (ADR-0001 Phase 1 exit criterion).
 *
 * For each `examples/<dir>/` with both an `input.*` query file and an
 * `expected-plan.md` golden, treat that pair as a (query, gold doc)
 * combination:
 *
 *   1. Build a fresh in-memory rag-index that excludes the leave-one-out
 *      doc itself.
 *   2. Run BM25 retrieval against the query.
 *   3. For each retrieved doc, mark it RELEVANT when it shares the
 *      framework or at least one KB-ID with the held-out gold.
 *   4. Compute the per-query Average Precision @ 3 (AP@3): the sum of
 *      precision-at-k for each k where a relevant doc appears, divided by
 *      the smaller of 3 and the number of relevant docs in the candidate
 *      set. Queries with no relevant candidates contribute 0.
 *   5. The mean across all queries is the MAP@3 score.
 *
 * Phase 1 exit criterion (ADR §6): held-out MAP@3 >= 0.6.
 *
 * Output:
 *   - Per-query breakdown table.
 *   - Aggregate MAP@3 with verdict (PASS / HOLD / INSUFFICIENT-DATA).
 *
 * CLI:
 *   npx tsx scripts/rag-map3-evaluator.ts [--k <n>] [--min-queries <n>]
 *                                          [--json] [--quiet]
 *
 * --k            top-K used by retrieval (default 3, matches the exit
 *                criterion expression).
 * --min-queries  minimum query count for the verdict to be non-INSUFFICIENT-
 *                DATA (default 5).
 * --json         emit machine-readable JSON instead of markdown.
 * --quiet        suppress the stderr summary line.
 *
 * Exit codes:
 *   0 = report produced (signal only; this script is not a CI gate yet)
 *   1 = file-system error reading the corpus
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const EXAMPLES_DIR = join(REPO_ROOT, "examples");
const DEFAULT_K = 3;
const DEFAULT_MIN_QUERIES = 5;
const MAP_PASS_THRESHOLD = 0.6;
const K1 = 1.5;
const B = 0.75;

import { FRAMEWORKS as KNOWN_FRAMEWORKS } from "./lib/frameworks.js";
type Framework = (typeof KNOWN_FRAMEWORKS)[number] | "unknown";

const FRAMEWORK_BY_EXT: Record<string, Framework> = {
  ".java": "selenium-java",
  ".py": "selenium-python",
  ".spec.ts": "bad-playwright",
  ".cy.js": "cypress",
  ".cy.ts": "cypress",
};

interface CliArgs {
  k: number;
  minQueries: number;
  json: boolean;
  quiet: boolean;
}

interface CorpusDoc {
  id: string;
  inputPath: string | null;
  framework: Framework;
  kbIds: Set<string>;
  bodyTokens: string[];
}

interface QueryResult {
  queryId: string;
  framework: Framework;
  relevantCount: number;
  topKIds: string[];
  apAt3: number;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      k: { type: "string" },
      "min-queries": { type: "string" },
      json: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
    },
  });
  let k = DEFAULT_K;
  if (typeof values.k === "string") {
    const parsed = Number.parseInt(values.k, 10);
    if (Number.isFinite(parsed) && parsed > 0) k = parsed;
  }
  let minQueries = DEFAULT_MIN_QUERIES;
  if (typeof values["min-queries"] === "string") {
    const parsed = Number.parseInt(values["min-queries"], 10);
    if (Number.isFinite(parsed) && parsed > 0) minQueries = parsed;
  }
  return {
    k,
    minQueries,
    json: values.json === true,
    quiet: values.quiet === true,
  };
}

function frameworkFromBody(body: string): Framework {
  const m = /##\s+Source framework\s*\n+\s*\**\s*([a-zA-Z][a-zA-Z\- ]*)/i.exec(body);
  if (m === null) return "unknown";
  const raw = (m[1] ?? "").toLowerCase().trim().replaceAll("*", "").replaceAll(/\s+/g, "-");
  for (const fw of KNOWN_FRAMEWORKS) {
    if (raw.includes(fw)) return fw;
  }
  return "unknown";
}

function parseKbIds(body: string): Set<string> {
  const ids = new Set<string>();
  const pattern = /KB-\d+(?:\.\d+){1,3}/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    ids.add(m[0]);
  }
  return ids;
}

function tokenize(text: string): string[] {
  return text
    .split(/[\s,;:|()[\]{}<>"`'\\/]+/g)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
}

function frameworkFromInputPath(path: string): Framework {
  for (const [suffix, fw] of Object.entries(FRAMEWORK_BY_EXT)) {
    if (path.endsWith(suffix)) return fw;
  }
  return "unknown";
}

function readInputFile(dir: string): string | null {
  const entries = readdirSync(dir);
  for (const name of entries) {
    if (name.startsWith("input.")) {
      const full = join(dir, name);
      try {
        if (statSync(full).isFile()) return full;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function loadCorpus(): CorpusDoc[] {
  if (!existsSync(EXAMPLES_DIR)) return [];
  const docs: CorpusDoc[] = [];
  for (const dir of readdirSync(EXAMPLES_DIR).sort((a, b) => a.localeCompare(b))) {
    if (dir === "reference" || dir === "sample-suite") continue;
    const dirPath = join(EXAMPLES_DIR, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    const planPath = join(dirPath, "expected-plan.md");
    if (!existsSync(planPath)) continue;
    const planBody = readFileSync(planPath, "utf8");
    docs.push({
      id: `examples/${dir}`,
      inputPath: readInputFile(dirPath),
      framework: frameworkFromBody(planBody),
      kbIds: parseKbIds(planBody),
      bodyTokens: tokenize(planBody.slice(0, 3000)),
    });
  }
  return docs;
}

function isRelevant(query: CorpusDoc, candidate: CorpusDoc): boolean {
  if (query.framework !== "unknown" && query.framework === candidate.framework) {
    return true;
  }
  for (const id of query.kbIds) {
    if (candidate.kbIds.has(id)) return true;
  }
  return false;
}

interface BM25Index {
  docs: CorpusDoc[];
  docTokens: string[][];
  termIdf: Map<string, number>;
  avgDocLen: number;
}

function buildIndex(docs: CorpusDoc[]): BM25Index {
  const docTokens = docs.map((d) => [
    d.framework,
    ...[...d.kbIds],
    ...d.bodyTokens,
  ]);
  const df = new Map<string, number>();
  for (const toks of docTokens) {
    for (const term of new Set(toks)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const N = docs.length;
  const termIdf = new Map<string, number>();
  for (const [term, dfVal] of df.entries()) {
    termIdf.set(term, Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1));
  }
  const avgDocLen = docTokens.reduce((acc, d) => acc + d.length, 0) / Math.max(1, docTokens.length);
  return { docs, docTokens, termIdf, avgDocLen };
}

function score(index: BM25Index, query: string[], docIdx: number): number {
  const docToks = index.docTokens[docIdx];
  if (!docToks) return 0;
  const docLen = docToks.length;
  const tf = new Map<string, number>();
  for (const t of docToks) tf.set(t, (tf.get(t) ?? 0) + 1);
  let total = 0;
  for (const q of query) {
    const idf = index.termIdf.get(q);
    if (idf === undefined) continue;
    const f = tf.get(q) ?? 0;
    if (f === 0) continue;
    const num = f * (K1 + 1);
    const den = f + K1 * (1 - B + B * (docLen / index.avgDocLen));
    total += idf * (num / den);
  }
  return total;
}

function buildQueryFromDoc(doc: CorpusDoc): string[] {
  // Use the doc's own framework + KB-IDs + a slice of the input file as the
  // query. Mirrors the production retrieval-bm25.ts query construction.
  const tokens = new Set<string>([doc.framework, ...doc.kbIds]);
  if (doc.inputPath !== null && existsSync(doc.inputPath)) {
    try {
      const body = readFileSync(doc.inputPath, "utf8");
      for (const t of tokenize(body.slice(0, 2000))) tokens.add(t);
    } catch {
      // ignore
    }
  }
  return [...tokens];
}

function evaluateLeaveOneOut(corpus: CorpusDoc[], k: number): QueryResult[] {
  const results: QueryResult[] = [];
  for (let i = 0; i < corpus.length; i += 1) {
    const heldOut = corpus[i];
    if (heldOut === undefined) continue;
    const remaining = corpus.filter((_, j) => j !== i);
    const relevantInCorpus = remaining.filter((d) => isRelevant(heldOut, d));
    const relevantCount = relevantInCorpus.length;
    const index = buildIndex(remaining);
    const query = buildQueryFromDoc(heldOut);
    const scored = remaining.map((doc, j) => ({
      doc,
      sc: score(index, query, j),
    }));
    scored.sort((a, b) => b.sc - a.sc);
    const topK = scored.slice(0, k);
    let hits = 0;
    let ap = 0;
    for (let rank = 0; rank < topK.length; rank += 1) {
      const entry = topK[rank];
      if (entry === undefined) continue;
      if (isRelevant(heldOut, entry.doc)) {
        hits += 1;
        ap += hits / (rank + 1);
      }
    }
    const denom = Math.min(k, relevantCount);
    const apAt3 = denom === 0 ? 0 : ap / denom;
    results.push({
      queryId: heldOut.id,
      framework: heldOut.framework,
      relevantCount,
      topKIds: topK.map((e) => e.doc.id),
      apAt3: Math.round(apAt3 * 1000) / 1000,
    });
  }
  return results;
}

interface MapReport {
  k: number;
  queryCount: number;
  minQueries: number;
  meanAveragePrecision: number;
  threshold: number;
  verdict: "PASS" | "HOLD" | "INSUFFICIENT-DATA";
  rationale: string;
  perQuery: QueryResult[];
}

/**
 * Decide the Phase 1 retrieval-quality verdict from the held-out MAP score.
 * Insufficient data wins over everything: when `count < args.minQueries` the
 * verdict is `INSUFFICIENT-DATA` regardless of the MAP value. Otherwise a MAP
 * at or above {@link MAP_PASS_THRESHOLD} is `PASS`, below it is `HOLD`.
 *
 * @param map mean average precision @k, in [0, 1].
 * @param count number of queries actually evaluated.
 * @param args parsed CLI args (uses `k` for messaging, `minQueries` as the floor).
 * @returns the verdict plus a human-readable rationale string.
 */
export function deriveVerdict(map: number, count: number, args: CliArgs): { verdict: MapReport["verdict"]; rationale: string } {
  if (count < args.minQueries) {
    return {
      verdict: "INSUFFICIENT-DATA",
      rationale: `Need at least ${args.minQueries} queries; corpus has ${count}.`,
    };
  }
  if (map >= MAP_PASS_THRESHOLD) {
    return {
      verdict: "PASS",
      rationale: `MAP@${args.k} ${map.toFixed(3)} >= ${MAP_PASS_THRESHOLD.toFixed(2)} - Phase 1 retrieval-quality criterion met.`,
    };
  }
  return {
    verdict: "HOLD",
    rationale: `MAP@${args.k} ${map.toFixed(3)} < ${MAP_PASS_THRESHOLD.toFixed(2)}; either grow the corpus or tune query construction.`,
  };
}

function renderMarkdown(report: MapReport): string {
  const lines: string[] = [];
  lines.push("# RAG MAP@" + report.k + " evaluation (Phase 1)");
  lines.push("");
  lines.push(`Queries evaluated: ${report.queryCount} (min required ${report.minQueries})`);
  lines.push("");
  lines.push("| Query | Framework | Relevant in corpus | Top-K hits | AP@" + report.k + " |");
  lines.push("|---|---|---:|---|---:|");
  for (const q of report.perQuery) {
    lines.push(`| ${q.queryId} | ${q.framework} | ${q.relevantCount} | ${q.topKIds.join(", ")} | ${q.apAt3.toFixed(3)} |`);
  }
  lines.push("");
  lines.push(`**MAP@${report.k}:** ${report.meanAveragePrecision.toFixed(3)}`);
  lines.push("");
  lines.push(`**Phase 1 retrieval-quality gate:** ${report.verdict}`);
  lines.push("");
  lines.push(report.rationale);
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const args = parseCliArgs();
  const corpus = loadCorpus();
  if (corpus.length === 0) {
    process.stderr.write("no examples found under examples/ - cannot evaluate MAP\n");
    process.exit(1);
  }
  const perQuery = evaluateLeaveOneOut(corpus, args.k);
  const meanAveragePrecision =
    perQuery.length === 0 ? 0 : perQuery.reduce((acc, r) => acc + r.apAt3, 0) / perQuery.length;
  const map = Math.round(meanAveragePrecision * 1000) / 1000;
  const { verdict, rationale } = deriveVerdict(map, perQuery.length, args);
  const report: MapReport = {
    k: args.k,
    queryCount: perQuery.length,
    minQueries: args.minQueries,
    meanAveragePrecision: map,
    threshold: MAP_PASS_THRESHOLD,
    verdict,
    rationale,
    perQuery,
  };
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderMarkdown(report));
  }
  if (!args.quiet) {
    process.stderr.write(`rag-map3: queries=${perQuery.length} MAP@${args.k}=${map.toFixed(3)} verdict=${verdict}\n`);
  }
}

// Only run the CLI when invoked directly — importing for tests must not scan.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
