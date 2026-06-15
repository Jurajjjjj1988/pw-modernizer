#!/usr/bin/env node
/**
 * rag-context-render.ts - format BM25 retrieval results as a compact
 * markdown block for prompt injection.
 *
 * Phase 1 of ADR-0001. The companion to retrieval-bm25.ts:
 *
 *   retrieval-bm25.ts --input X --out R.json  ->  JSON top-K
 *   rag-context-render.ts --results R.json --out C.md   ->  markdown for analyze.md
 *
 * The output markdown is consumed by `prompts/_fragments/rag-context.md`
 * via the assemble-prompts include marker so it ends up in the cached
 * prefix that Stage 1 sends to Sonnet.
 *
 * Render contract:
 *
 *   - One `## Past similar migration N: <id>` section per result
 *   - Per result: framework + verdict line, KB-ID list, an excerpt of the
 *     plan body (the anti-pattern table is the most reusable signal)
 *   - Empty input -> empty markdown (no header, no padding). The include
 *     placeholder fragment is left empty in that case.
 *
 * CLI:
 *   npx tsx scripts/rag-context-render.ts --results <path> [--out <path>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

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
  results: string;
  out: string | undefined;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      results: { type: "string" },
      out: { type: "string" },
    },
  });
  if (values.results === undefined || values.results === "") {
    process.stderr.write("--results is required\n");
    process.exit(2);
  }
  return { results: values.results, out: values.out };
}

function readResults(path: string): RetrievalResult[] {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("results file is not an array");
    }
    return parsed as RetrievalResult[];
  } catch (err) {
    process.stderr.write(`failed to read results at ${path}: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function renderResult(result: RetrievalResult, index: number): string {
  const lines: string[] = [];
  lines.push(`## Past similar migration ${index + 1}: ${result.id}`);
  lines.push("");
  lines.push(
    `- **Framework:** ${result.framework} | **Verdict:** ${result.verdict} | **Retrieval score:** ${result.score.toFixed(2)}`,
  );
  if (result.kbIds.length > 0) {
    lines.push(`- **KB IDs cited:** ${result.kbIds.join(", ")}`);
  }
  lines.push(`- **Full plan:** \`${result.planPath}\``);
  lines.push("");
  lines.push("### Plan excerpt");
  lines.push("");
  lines.push(result.planExcerpt.trim());
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const args = parseCliArgs();
  const results = readResults(args.results);

  let markdown = "";
  if (results.length > 0) {
    const header = [
      "# RAG context: past similar migrations",
      "",
      `Retrieved via BM25 over outputs/.rag-index.json (Phase 1, ADR-0001).`,
      `These are SHIP-IT-verdict or golden-example plans that share framework`,
      `or anti-pattern KB-IDs with the current input. Use them as reference`,
      `style anchors; do NOT copy locator pins or scenario IDs verbatim.`,
      "",
      "---",
      "",
    ].join("\n");
    const body = results.map((r, i) => renderResult(r, i)).join("\n---\n\n");
    markdown = header + body;
  }

  if (args.out !== undefined) {
    const outDir = dirname(args.out);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(args.out, markdown, "utf8");
    process.stderr.write(
      `rag-context-render: ${results.length} result(s) -> ${args.out.startsWith(REPO_ROOT + "/") ? args.out.slice(REPO_ROOT.length + 1) : args.out}\n`,
    );
  } else {
    process.stdout.write(markdown);
  }
}

main();
