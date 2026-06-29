#!/usr/bin/env tsx
/**
 * explain-migration.ts — a zero-token, read-only CLI that explains, in plain
 * language, what a single migration did: which input it came from, the verdict
 * and confidence the scorer assigned, the KB anti-patterns the plan addressed,
 * which pwm-blueprint files were emitted, and the smell deltas (including any
 * REGRESSIONS — smells the output added).
 *
 * It is a JOIN over parsers that already exist — it imports verdictFromReportBody
 * (index-plans.ts) and reads the rendered report rather than recomputing, so the
 * explanation can never drift from what the pipeline actually scored.
 *
 * Artifact resolution is INPUT-keyed, not spec-keyed: a Selenium/Cypress spec is
 * kebab-renamed (AddCookiesJupiterTest.java → add-cookies-jupiter-test.spec.ts)
 * but its plan/envelope/report are keyed to the input basename. We recover that
 * base from the spec's `See outputs/plans/<base>.md` header (present in every
 * emitted spec), so resolution is correct across all four frameworks.
 *
 * Usage:
 *   npm run explain -- --spec outputs/tests/force-clicks.spec.ts
 *   npm run explain -- --spec <path> --json
 *
 * Exit codes: 0 = explanation produced (even if some artifacts are missing —
 * they are listed), 1 = the --spec file itself could not be read.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { verdictFromReportBody } from "./index-plans.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

export interface SmellDelta { smell: string; source: number; output: number; delta: number }
export interface Explanation {
  spec: string;
  base: string;
  inputPath: string;
  framework: string;
  verdict: string;
  confidence: number | null;
  scenarios: Array<{ id: string; title: string }>;
  emittedFiles: string[];
  kbAntiPatterns: Array<{ id: string; name: string }>;
  lowConfidenceLocators: number;
  defensePins: number;
  smellDeltas: SmellDelta[];
  regressions: SmellDelta[];
  missingArtifacts: string[];
}

// ---- tiny, `any`-free JSON accessors -----------------------------------------
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ---- parsers -----------------------------------------------------------------

/** Recover the INPUT-keyed base + input path from the emitted spec's header. */
export function parseSpecHeader(specSrc: string): { base: string | null; inputPath: string } {
  const planRef = /See\s+outputs\/plans\/(.+?\.md)\b/i.exec(specSrc);
  const base = planRef?.[1] !== undefined ? planRef[1].replace(/\.md$/i, "") : null;
  const inputRef = /from\s+(inputs\/\S+)/i.exec(specSrc);
  const inputPath = inputRef?.[1] !== undefined ? inputRef[1].replace(/[.\s]+$/, "") : "unknown";
  return { base, inputPath };
}

interface EnvelopeFacts {
  framework: string;
  scenarios: Array<{ id: string; title: string }>;
  emittedFiles: string[];
  lowConfidenceLocators: number;
  defensePins: number;
}

function parseEnvelope(raw: string | null): EnvelopeFacts {
  const empty: EnvelopeFacts = { framework: "unknown", scenarios: [], emittedFiles: [], lowConfidenceLocators: 0, defensePins: 0 };
  if (raw === null) return empty;
  let obj: Record<string, unknown>;
  try {
    obj = asRecord(JSON.parse(raw));
  } catch {
    return empty;
  }
  const scenarios = asArray(obj["scenarios"]).map((s) => {
    const r = asRecord(s);
    return { id: asString(r["id"]) || "?", title: asString(r["title"]) || asString(r["name"]) };
  });
  const emittedFiles: string[] = [];
  for (const key of Object.keys(obj)) {
    if (!key.startsWith("required")) continue;
    for (const f of asArray(obj[key])) {
      const path = typeof f === "string" ? f : asString(asRecord(f)["path"]) || asString(asRecord(f)["file"]);
      if (path !== "") emittedFiles.push(path);
    }
  }
  const lowConfidenceLocators = asArray(obj["locatorTable"])
    .filter((l) => asString(asRecord(l)["confidence"]).toLowerCase() === "low").length;
  return {
    framework: asString(obj["sourceFramework"]) || "unknown",
    scenarios,
    emittedFiles: [...new Set(emittedFiles)],
    lowConfidenceLocators,
    defensePins: asArray(obj["hallucinationDefensePins"]).length,
  };
}

/** KB-ID ↔ anti-pattern-name pairs from the plan's markdown table (col 3 = KB
 * ID, col 4 = anti-pattern name), de-duplicated by ID. */
export function parsePlanAntiPatterns(planMd: string | null): Array<{ id: string; name: string }> {
  if (planMd === null) return [];
  const byId = new Map<string, string>();
  const row = /^\|[^|]*\|[^|]*\|\s*(KB-\d+(?:\.\d+){1,3})\s*\|\s*([^|]+?)\s*\|/gm;
  for (let m = row.exec(planMd); m !== null; m = row.exec(planMd)) {
    if (m[1] !== undefined && !byId.has(m[1])) byId.set(m[1], (m[2] ?? "").trim());
  }
  return [...byId].map(([id, name]) => ({ id, name }));
}

/** Confidence + smell deltas straight from the rendered report (no recompute). */
export function parseReport(reportMd: string | null): { confidence: number | null; smellDeltas: SmellDelta[] } {
  if (reportMd === null) return { confidence: null, smellDeltas: [] };
  const conf = /Aggregate confidence:\**\s*(\d+(?:\.\d+)?)/i.exec(reportMd);
  const smellDeltas: SmellDelta[] = [];
  const row = /^\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([+-]?\d+)\s*\|/gm;
  for (let m = row.exec(reportMd); m !== null; m = row.exec(reportMd)) {
    smellDeltas.push({
      smell: m[1] ?? "",
      source: Number(m[2] ?? 0),
      output: Number(m[3] ?? 0),
      delta: Number(m[4] ?? 0),
    });
  }
  return { confidence: conf?.[1] !== undefined ? Number(conf[1]) : null, smellDeltas };
}

// ---- pure core ---------------------------------------------------------------

export interface ExplainInputs {
  specPath: string;
  specSrc: string;
  planMd: string | null;
  envelopeRaw: string | null;
  reportMd: string | null;
}

export function buildExplanation(inp: ExplainInputs): Explanation {
  const header = parseSpecHeader(inp.specSrc);
  const env = parseEnvelope(inp.envelopeRaw);
  const report = parseReport(inp.reportMd);
  const missingArtifacts: string[] = [];
  if (inp.planMd === null) missingArtifacts.push("plan");
  if (inp.envelopeRaw === null) missingArtifacts.push("envelope");
  if (inp.reportMd === null) missingArtifacts.push("report");
  return {
    spec: inp.specPath,
    base: header.base ?? basename(inp.specPath),
    inputPath: header.inputPath,
    framework: env.framework,
    verdict: inp.reportMd === null ? "unknown" : verdictFromReportBody(inp.reportMd),
    confidence: report.confidence,
    scenarios: env.scenarios,
    emittedFiles: env.emittedFiles,
    kbAntiPatterns: parsePlanAntiPatterns(inp.planMd),
    lowConfidenceLocators: env.lowConfidenceLocators,
    defensePins: env.defensePins,
    smellDeltas: report.smellDeltas,
    regressions: report.smellDeltas.filter((d) => d.delta > 0),
    missingArtifacts,
  };
}

// ---- rendering + I/O ---------------------------------------------------------

function renderHuman(e: Explanation): string {
  const lines: string[] = [];
  lines.push(`\n  Migration: ${basename(e.spec)}`);
  lines.push(`  ├─ from input:   ${e.inputPath} (${e.framework})`);
  lines.push(`  ├─ verdict:      ${e.verdict}${e.confidence !== null ? ` (confidence ${e.confidence.toFixed(2)})` : ""}`);
  lines.push(`  ├─ scenarios:    ${e.scenarios.length}`);
  for (const s of e.scenarios) lines.push(`  │    • [${s.id}] ${s.title}`);
  lines.push(`  ├─ KB anti-patterns addressed: ${e.kbAntiPatterns.length}`);
  for (const k of e.kbAntiPatterns) lines.push(`  │    • ${k.id} — ${k.name}`);
  lines.push(`  ├─ emitted files: ${e.emittedFiles.length}`);
  for (const f of e.emittedFiles) lines.push(`  │    • ${f}`);
  lines.push(`  ├─ DOM-grounding: ${e.lowConfidenceLocators} LOW-confidence locator(s), ${e.defensePins} defense pin(s)`);
  if (e.regressions.length > 0) {
    lines.push(`  ├─ ⚠ REGRESSIONS (smells the output ADDED):`);
    for (const r of e.regressions) lines.push(`  │    • ${r.smell}: +${r.delta}`);
  } else {
    lines.push(`  ├─ ✅ no smell regressions`);
  }
  if (e.missingArtifacts.length > 0) lines.push(`  └─ missing artifacts: ${e.missingArtifacts.join(", ")}`);
  else lines.push(`  └─ all artifacts present`);
  lines.push("");
  return lines.join("\n");
}

interface CliArgs { spec: string; json: boolean; root: string }

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      spec: { type: "string" },
      json: { type: "boolean", default: false },
      root: { type: "string" },
    },
  });
  return { spec: values.spec ?? "", json: values.json === true, root: values.root ?? REPO_ROOT };
}

function readOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function main(): number {
  const args = parseCliArgs();
  if (args.spec === "") {
    process.stderr.write("  ERROR: --spec <path> is required.\n");
    return 1;
  }
  const specPath = resolve(args.root, args.spec);
  if (!existsSync(specPath)) {
    process.stderr.write(`  ERROR: spec not found: ${specPath}\n`);
    return 1;
  }
  const specSrc = readFileSync(specPath, "utf8");
  // INPUT-keyed resolution: recover the base from the spec header, fall back to
  // the spec's own basename if the header lacks the plan reference.
  const base = parseSpecHeader(specSrc).base ?? basename(specPath);
  const planMd = readOrNull(join(args.root, "outputs/plans", `${base}.md`));
  const envelopeRaw = readOrNull(join(args.root, "outputs/plans", `${base}.envelope.json`));
  const reportMd = readOrNull(join(args.root, "outputs/reports", `${base}.md`));

  const explanation = buildExplanation({ specPath, specSrc, planMd, envelopeRaw, reportMd });
  process.stdout.write(args.json ? JSON.stringify(explanation, null, 2) + "\n" : renderHuman(explanation));
  return 0;
}

// Only run the CLI when invoked directly — importing for tests must not run it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
