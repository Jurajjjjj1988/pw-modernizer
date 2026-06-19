#!/usr/bin/env node
/**
 * index-plans.ts - build the retrieval index over past migration plans.
 *
 * Phase 1 of ADR-0001 (self-improvement via RAG over past migrations).
 *
 * Walks two corpus sources, parses structured fields, writes a deterministic
 * `outputs/.rag-index.json` so retrieval scripts read one file instead of
 * grepping the whole plans tree on every Stage 1 invocation.
 *
 * Sources walked:
 *
 *   1. `outputs/plans/*.md` + `outputs/plans/*.envelope.json` - real
 *      migration plans the pipeline produced
 *   2. `examples/<framework>-<n>/expected-plan.md` (+ envelope) - golden
 *      reference plans hand-curated as calibration anchors
 *
 * For each plan we extract:
 *
 *   - basename: stripped of `.md` / `.envelope.json` suffix, used as the doc id
 *   - source: "outputs" | "examples"
 *   - sourceFramework: parsed from the `## Source framework` markdown section
 *     (matches one of bad-playwright / cypress / selenium-java / selenium-python
 *     or `unknown` if the section is missing)
 *   - verdict: parsed from `outputs/reports/<basename>.md` if present, one of
 *     SHIP IT / FIX FIRST / START OVER / unknown. Goldens always count as
 *     SHIP IT (they are the calibration baseline by construction).
 *   - kbIds: anti-pattern KB IDs cited in the plan markdown table. The plan
 *     format guarantees a `| KB-<n>.<n>.<n> |` regex per anti-pattern row.
 *   - locatorConfidence: histogram from the envelope JSON (HIGH/MED/LOW per
 *     locator pin). When the envelope is missing we record nulls.
 *   - planBody: the raw plan markdown content (capped at 8 KB so the index
 *     stays small; full plan is read on demand via `basename`).
 *
 * Output shape (versioned):
 *
 *   {
 *     "version": 1,
 *     "generatedAt": "2026-06-16T...Z",
 *     "sourceHash": "<sha256-of-concatenated-plan-files>",
 *     "documents": [
 *       {
 *         "id": "<basename>",
 *         "source": "outputs",
 *         "sourceFramework": "bad-playwright",
 *         "verdict": "SHIP IT",
 *         "kbIds": ["KB-1.1.1", "KB-1.1.5", ...],
 *         "locatorConfidence": {"HIGH": 3, "MED": 1, "LOW": 2},
 *         "planBody": "..."
 *       }
 *     ]
 *   }
 *
 * SHA-256 caching: on subsequent runs we hash the concatenated plan file
 * contents (deterministic order) and compare against the marker in the
 * existing index. Match = skip rebuild. Same pattern as `build-inventory.ts`.
 *
 * CLI:
 *   npx tsx scripts/index-plans.ts [--out <path>] [--force]
 *
 * --out (default: outputs/.rag-index.json) - destination file
 * --force - ignore the SHA cache and always rebuild
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_OUT = join(REPO_ROOT, "outputs", ".rag-index.json");
const OUTPUTS_PLANS_DIR = join(REPO_ROOT, "outputs", "plans");
const OUTPUTS_REPORTS_DIR = join(REPO_ROOT, "outputs", "reports");
const EXAMPLES_DIR = join(REPO_ROOT, "examples");

import { FRAMEWORKS as KNOWN_FRAMEWORKS } from "./lib/frameworks.js";
type Framework = (typeof KNOWN_FRAMEWORKS)[number] | "unknown";

const KNOWN_VERDICTS = ["SHIP IT", "FIX FIRST", "START OVER", "unknown"] as const;
type Verdict = (typeof KNOWN_VERDICTS)[number];

const PLAN_BODY_CAP_BYTES = 8 * 1024;
const INDEX_VERSION = 1;

interface PlanDocument {
  id: string;
  source: "outputs" | "examples";
  sourceFramework: Framework;
  verdict: Verdict;
  kbIds: string[];
  locatorConfidence: { HIGH: number; MED: number; LOW: number } | null;
  planBody: string;
  planPath: string;
}

interface IndexFile {
  version: number;
  generatedAt: string;
  sourceHash: string;
  documents: PlanDocument[];
}

interface Args {
  out: string;
  force: boolean;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      force: { type: "boolean", default: false },
    },
  });
  return { out: values.out ?? DEFAULT_OUT, force: values.force === true };
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function parseSourceFramework(body: string): Framework {
  // Two variants seen across the corpus:
  //   `## Source framework\n\n**Selenium Java** ...`  (bad-pw, sel-java)
  //   `## Source framework\ncypress`                   (cypress, sel-python)
  // Extract the first non-empty line under the heading and substring-match
  // against the known set. Substring covers both styles without exotic regex.
  const idx = body.search(/##\s+Source framework/i);
  if (idx < 0) return "unknown";
  const tail = body.slice(idx);
  for (const line of tail.split("\n").slice(1)) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "") continue;
    if (trimmed.startsWith("##")) return "unknown";
    const normalised = trimmed.replaceAll("*", "").replaceAll(/\s+/g, "-");
    for (const fw of KNOWN_FRAMEWORKS) {
      if (normalised.includes(fw)) return fw;
    }
    return "unknown";
  }
  return "unknown";
}

function parseKbIds(body: string): string[] {
  // Anti-pattern rows: `| H | <line> | KB-1.1.1 | hard-wait | ... |`.
  // We deliberately match anywhere in the markdown - some plans reference
  // KB IDs in prose under "## Notes" too, which is still retrieval-relevant.
  const ids = new Set<string>();
  const pattern = /KB-\d+(?:\.\d+){1,3}/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    ids.add(m[0]);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function parseLocatorConfidence(envelopePath: string): PlanDocument["locatorConfidence"] {
  const raw = safeRead(envelopePath);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const histogram = { HIGH: 0, MED: 0, LOW: 0 };
    const root = parsed as Record<string, unknown>;
    const scenarios = root["scenarios"];
    if (!Array.isArray(scenarios)) return histogram;
    for (const scenario of scenarios) {
      if (scenario === null || typeof scenario !== "object") continue;
      const pins = (scenario as Record<string, unknown>)["locatorPins"];
      if (!Array.isArray(pins)) continue;
      for (const pin of pins) {
        if (pin === null || typeof pin !== "object") continue;
        const conf = (pin as Record<string, unknown>)["confidence"];
        if (conf === "HIGH" || conf === "MED" || conf === "LOW") {
          histogram[conf] += 1;
        }
      }
    }
    return histogram;
  } catch {
    return null;
  }
}

function parseReportVerdict(reportPath: string): Verdict {
  const body = safeRead(reportPath);
  if (body === null) return "unknown";
  // Verify report standardised header: `Verdict: **SHIP IT**` or unbolded.
  const match = /^(?:- )?Verdict:\s*\**\s*(SHIP IT|FIX FIRST|START OVER)\s*\**/im.exec(body);
  if (match === null) return "unknown";
  const v = match[1];
  for (const known of KNOWN_VERDICTS) {
    if (known === v) return known;
  }
  return "unknown";
}

function capBody(body: string): string {
  if (Buffer.byteLength(body, "utf8") <= PLAN_BODY_CAP_BYTES) return body;
  return body.slice(0, PLAN_BODY_CAP_BYTES) + "\n... [capped]";
}

function collectOutputsPlans(): PlanDocument[] {
  if (!existsSync(OUTPUTS_PLANS_DIR)) return [];
  const out: PlanDocument[] = [];
  for (const file of readdirSync(OUTPUTS_PLANS_DIR).sort((a, b) => a.localeCompare(b))) {
    if (!file.endsWith(".md")) continue;
    const planPath = join(OUTPUTS_PLANS_DIR, file);
    const body = safeRead(planPath);
    if (body === null) continue;
    const basename = file.slice(0, -".md".length);
    const envelopePath = join(OUTPUTS_PLANS_DIR, `${basename}.envelope.json`);
    const reportPath = join(OUTPUTS_REPORTS_DIR, `${basename}.md`);
    out.push({
      id: basename,
      source: "outputs",
      sourceFramework: parseSourceFramework(body),
      verdict: parseReportVerdict(reportPath),
      kbIds: parseKbIds(body),
      locatorConfidence: parseLocatorConfidence(envelopePath),
      planBody: capBody(body),
      planPath: planPath.startsWith(REPO_ROOT + "/")
        ? planPath.slice(REPO_ROOT.length + 1)
        : planPath,
    });
  }
  return out;
}

function collectExamplePlans(): PlanDocument[] {
  if (!existsSync(EXAMPLES_DIR)) return [];
  const out: PlanDocument[] = [];
  for (const dir of readdirSync(EXAMPLES_DIR).sort((a, b) => a.localeCompare(b))) {
    if (dir === "reference") continue;
    if (dir === "sample-suite") continue;
    const dirPath = join(EXAMPLES_DIR, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    const planPath = join(dirPath, "expected-plan.md");
    const body = safeRead(planPath);
    if (body === null) continue;
    const envelopePath = join(dirPath, "expected-plan.envelope.json");
    out.push({
      id: `examples/${dir}`,
      source: "examples",
      sourceFramework: parseSourceFramework(body),
      verdict: "SHIP IT",
      kbIds: parseKbIds(body),
      locatorConfidence: parseLocatorConfidence(envelopePath),
      planBody: capBody(body),
      planPath: planPath.startsWith(REPO_ROOT + "/")
        ? planPath.slice(REPO_ROOT.length + 1)
        : planPath,
    });
  }
  return out;
}

function computeSourceHash(documents: PlanDocument[]): string {
  const hash = createHash("sha256");
  for (const doc of documents) {
    hash.update(doc.id);
    hash.update(" ");
    hash.update(doc.planBody);
    hash.update(" ");
  }
  return hash.digest("hex");
}

interface CachedHash {
  hash: string;
}

function readCachedHash(outPath: string): string | null {
  if (!existsSync(outPath)) return null;
  const body = safeRead(outPath);
  if (body === null) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== "object") return null;
    const h = (parsed as Partial<CachedHash>).hash ?? (parsed as Record<string, unknown>)["sourceHash"];
    return typeof h === "string" ? h : null;
  } catch {
    return null;
  }
}

function main(): void {
  const args = parseCliArgs();

  const documents = [...collectOutputsPlans(), ...collectExamplePlans()];
  const sourceHash = computeSourceHash(documents);

  if (!args.force) {
    const cached = readCachedHash(args.out);
    if (cached === sourceHash) {
      process.stdout.write(`rag-index unchanged; ${documents.length} documents; skipped rebuild\n`);
      process.exit(0);
    }
  }

  const index: IndexFile = {
    version: INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    sourceHash,
    documents,
  };

  const outDir = dirname(args.out);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(args.out, JSON.stringify(index, null, 2) + "\n", "utf8");

  process.stdout.write(
    `Indexed ${documents.length} plans (outputs: ${documents.filter((d) => d.source === "outputs").length}, examples: ${documents.filter((d) => d.source === "examples").length}); wrote ${args.out}\n`,
  );
}

main();
