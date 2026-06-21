#!/usr/bin/env node
/**
 * retrieval-bm25.ts - BM25 retrieval over the rag-index built by index-plans.ts.
 *
 * Phase 1 of ADR-0001. Plain BM25 (Lucene defaults k1=1.5, b=0.75) over a
 * mix of KB-ID tokens + framework tokens + a synthetic anti-pattern
 * fingerprint extracted from the QUERY input file. No embeddings, no
 * external vector DB, no transitive npm deps.
 *
 * Why BM25 over the indexed corpus directly (not raw plan source text):
 * the plans on disk already have the high-signal labels we'd otherwise pay
 * an embedding model to extract - the KB-ID anti-pattern catalogue is the
 * cross-framework retrieval bridge (a Cypress `cy.wait` plan and a Selenium
 * `Thread.sleep` plan both cite `KB-1.x.1`, so they retrieve each other).
 *
 * Filter rules:
 *
 *   - Candidates must have verdict == "SHIP IT" OR source == "examples"
 *     (golden anchors count as ships).
 *   - Same-input dedup: a plan that retrieves itself when we're querying
 *     over the same basename is excluded (covers the leave-one-out
 *     evaluation case).
 *
 * CLI:
 *   npx tsx scripts/retrieval-bm25.ts --input <path> [--out <json>] [--k <n>]
 *                                     [--index <path>] [--quiet]
 *
 *   --input  Path to the source test we're retrieving FOR (the new migration
 *            input). Used to derive the query: file extension -> framework,
 *            filename -> tokens, body -> anti-pattern fingerprint.
 *   --out    JSON file with the top-K results (default: stdout).
 *   --k      Top-K to return (default: 3, per ADR-0001 Phase 1).
 *   --index  Path to .rag-index.json (default: outputs/.rag-index.json).
 *   --quiet  Suppress the human-readable summary line on stderr.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_INDEX = `${REPO_ROOT}/outputs/.rag-index.json`;
const DEFAULT_K = 3;
const K1 = 1.5;
const B = 0.75;

const FRAMEWORK_HINTS: Record<string, string> = {
  ".cy.js": "cypress",
  ".cy.ts": "cypress",
  ".java": "selenium-java",
  ".py": "selenium-python",
  ".spec.ts": "bad-playwright",
};

// Anti-pattern fingerprint: tokens we sniff in the input that map to KB
// vocabulary. Keeping this explicit + small to make retrievals debuggable.
const FINGERPRINT_PATTERNS: Array<{ regex: RegExp; tokens: string[] }> = [
  { regex: /waitForTimeout/i, tokens: ["hard-wait", "KB-1.1.1"] },
  { regex: /Thread\.sleep/i, tokens: ["hard-wait", "KB-1.3.1"] },
  { regex: /time\.sleep/i, tokens: ["hard-wait", "KB-1.4.1"] },
  { regex: /cy\.wait\(\s*\d/i, tokens: ["hard-wait", "KB-1.2.1"] },
  { regex: /cy\.intercept/i, tokens: ["intercept-stub", "KB-1.2.11"] },
  { regex: /\.nth\(/i, tokens: ["nth-roulette", "KB-1.1.4"] },
  { regex: /WebDriverWait/i, tokens: ["explicit-wait", "KB-1.3.12"] },
  { regex: /storageState|cookie/i, tokens: ["session-auth", "KB-1.2.13"] },
  { regex: /isVisible\(\)|innerText\(\)/i, tokens: ["sync-probe", "KB-1.1.5"] },
  { regex: /@FindBy|By\.id|By\.css/i, tokens: ["pom-locator", "KB-1.3.23"] },
];

interface IndexedDocument {
  id: string;
  source: "outputs" | "examples";
  sourceFramework: string;
  verdict: string;
  kbIds: string[];
  locatorConfidence: { HIGH: number; MED: number; LOW: number } | null;
  planBody: string;
  planPath: string;
}

interface IndexFile {
  version: number;
  generatedAt: string;
  sourceHash: string;
  documents: IndexedDocument[];
}

interface RetrievalResult {
  id: string;
  score: number;
  framework: string;
  kbIds: string[];
  verdict: string;
  planPath: string;
  planExcerpt: string;
}

interface Args {
  input: string;
  out: string | undefined;
  k: number;
  index: string;
  quiet: boolean;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      out: { type: "string" },
      k: { type: "string" },
      index: { type: "string" },
      quiet: { type: "boolean", default: false },
    },
  });
  if (values.input === undefined || values.input === "") {
    process.stderr.write("--input is required\n");
    process.exit(2);
  }
  const kRaw = values.k;
  let k = DEFAULT_K;
  if (kRaw !== undefined) {
    const parsed = Number.parseInt(kRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) k = parsed;
  }
  return {
    input: values.input,
    out: values.out,
    k,
    index: values.index ?? DEFAULT_INDEX,
    quiet: values.quiet === true,
  };
}

function frameworkFromPath(path: string): string {
  for (const [suffix, fw] of Object.entries(FRAMEWORK_HINTS)) {
    if (path.endsWith(suffix)) return fw;
  }
  return "unknown";
}

export function fingerprintTokens(body: string): string[] {
  const out = new Set<string>();
  for (const { regex, tokens } of FINGERPRINT_PATTERNS) {
    if (regex.test(body)) {
      for (const t of tokens) out.add(t);
    }
  }
  return [...out];
}

function basenameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function tokenize(text: string): string[] {
  // Split on whitespace + punctuation; keep alpha-num + KB ID dotted form.
  // We keep `KB-1.1.1` intact because dots inside KB IDs are load-bearing.
  return text
    .split(/[\s,;:|()[\]{}<>"`'\\/]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function buildQuery(args: Args): string[] {
  let body = "";
  try {
    body = readFileSync(args.input, "utf8");
  } catch {
    // Fall through with empty body - framework hint + filename still help.
  }
  const tokens: string[] = [
    frameworkFromPath(args.input),
    ...tokenize(basenameFromPath(args.input)),
    ...fingerprintTokens(body),
  ];
  return tokens.filter((t) => t.length > 0).map((t) => t.toLowerCase());
}

function readIndex(path: string): IndexFile {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("index is not an object");
    }
    return parsed as IndexFile;
  } catch (err) {
    process.stderr.write(`failed to read index at ${path}: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function documentTokens(doc: IndexedDocument): string[] {
  // We index over the structured fields (framework + KB IDs) and a thin
  // slice of the plan body. The plan body shouldn't dominate the score,
  // hence the cap at the first 1.5 KB.
  const bodySlice = doc.planBody.slice(0, 1500);
  return [
    doc.sourceFramework,
    ...doc.kbIds,
    ...tokenize(bodySlice),
  ].map((t) => t.toLowerCase());
}

interface TermStats {
  df: number;
  idf: number;
}

function buildTermStats(docs: string[][]): Map<string, TermStats> {
  const df = new Map<string, number>();
  for (const tokens of docs) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const N = docs.length;
  const stats = new Map<string, TermStats>();
  for (const [term, dfVal] of df.entries()) {
    // Robertson-style IDF (matches Lucene): log((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1);
    stats.set(term, { df: dfVal, idf });
  }
  return stats;
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  termStats: Map<string, TermStats>,
  avgDocLen: number,
): number {
  const docLen = docTokens.length;
  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  for (const q of queryTokens) {
    const stat = termStats.get(q);
    if (stat === undefined) continue;
    const f = tf.get(q) ?? 0;
    if (f === 0) continue;
    const numerator = f * (K1 + 1);
    const denominator = f + K1 * (1 - B + B * (docLen / avgDocLen));
    score += stat.idf * (numerator / denominator);
  }
  return score;
}

function isCandidateEligible(doc: IndexedDocument, inputBasename: string): boolean {
  if (doc.id === inputBasename) return false; // leave-one-out guard
  if (doc.source === "examples") return true;
  return doc.verdict === "SHIP IT";
}

function makeExcerpt(body: string, max = 800): string {
  if (body.length <= max) return body;
  return body.slice(0, max) + "\n... [truncated]";
}

function main(): void {
  const args = parseCliArgs();
  const index = readIndex(args.index);
  const inputBasename = basenameFromPath(args.input);

  const candidates = index.documents.filter((d) => isCandidateEligible(d, inputBasename));
  if (candidates.length === 0) {
    const empty: RetrievalResult[] = [];
    if (args.out !== undefined) {
      const outDir = dirname(args.out);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(args.out, JSON.stringify(empty, null, 2) + "\n", "utf8");
    } else {
      process.stdout.write(JSON.stringify(empty, null, 2) + "\n");
    }
    if (!args.quiet) process.stderr.write("retrieval-bm25: no eligible candidates in index\n");
    return;
  }

  const queryTokens = buildQuery(args);
  const docTokens = candidates.map(documentTokens);
  const avgDocLen = docTokens.reduce((acc, d) => acc + d.length, 0) / docTokens.length;
  const termStats = buildTermStats(docTokens);

  const scored = candidates.map((doc, i) => ({
    doc,
    score: bm25Score(queryTokens, docTokens[i] ?? [], termStats, avgDocLen),
  }));

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, args.k).map(({ doc, score }) => ({
    id: doc.id,
    score: Math.round(score * 1000) / 1000,
    framework: doc.sourceFramework,
    kbIds: doc.kbIds,
    verdict: doc.verdict,
    planPath: doc.planPath,
    planExcerpt: makeExcerpt(doc.planBody),
  }));

  if (args.out !== undefined) {
    const outDir = dirname(args.out);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(args.out, JSON.stringify(top, null, 2) + "\n", "utf8");
  } else {
    process.stdout.write(JSON.stringify(top, null, 2) + "\n");
  }

  if (!args.quiet) {
    const summary = top
      .map((r) => `${r.id} (${r.framework}, score=${r.score.toFixed(2)})`)
      .join(" | ");
    process.stderr.write(`retrieval-bm25: ${args.k}/${candidates.length} -> ${summary}\n`);
  }
}

// Only run retrieval when invoked directly — importing for the MAP@3 evaluator
// or tests (which reuse fingerprintTokens) must not execute a query / exit.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
