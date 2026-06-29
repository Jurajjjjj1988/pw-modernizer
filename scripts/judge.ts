#!/usr/bin/env tsx
/**
 * judge.ts — calibrated LLM-as-judge for the NON-executable quality axes (BP8).
 *
 * Execution (run-against-sut) proves a migration WORKS. It cannot judge whether
 * the code is readable, idiomatic Playwright, free of test smells, or preserves
 * the source's assertion intent. Prior art (MT-Bench, G-Eval, "Survey on
 * LLM-as-a-Judge"): a REFERENCE-GUIDED judge (the source test is the reference)
 * with criteria DECOMPOSED into per-axis scores, calibrated against a human gold
 * set with Cohen's kappa (>= ~0.6 before trusting it unsupervised). The judge is
 * a SIGNAL for review, never the correctness gate — that's execution's job.
 *
 *   npx tsx scripts/judge.ts --input-basename <base> [--source <legacy-test>]
 *   npx tsx scripts/judge.ts --calibrate labels/judge-gold.jsonl   # kappa vs human
 *
 * Pure core (buildJudgePrompt / parseScores / verdictFromScores) is unit-tested.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { collectEmittedFiles, collectEmittedSources } from "./evaluate.js";
import { findGeneratedSpec } from "./output-spec.js";
import { cohensKappa, kappaLabel } from "./lib/kappa.js";
import { runClaudeCli } from "./lib/claude-cli.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

/** The non-executable axes, decomposed (G-Eval criteria-decomposition). */
export const AXES = ["readability", "idiomatic-playwright", "no-test-smells", "assertion-intent-preserved"] as const;
export type Axis = (typeof AXES)[number];

/**
 * Reference-guided judge prompt: the SOURCE test is the reference; the judge
 * first describes what the source verifies (CoT), then scores each axis 1-5 on
 * the migrated tree, and must IGNORE length (verbosity-bias guard) and not
 * reward added-but-unverified steps.
 */
export function buildJudgePrompt(sourceTest: string, migratedTree: string): string {
  return [
    "You are a senior SDET judging a MIGRATED Playwright test against its SOURCE (the reference).",
    "First, in 2-3 sentences, state what the SOURCE test verifies (the user journey + its assertions).",
    "Then score the MIGRATED tree on each axis from 1 (poor) to 5 (excellent). Output ONLY a JSON object",
    `with integer keys: {${AXES.map((a) => `"${a}": <1-5>`).join(", ")}}.`,
    "",
    "Rules (bias guards):",
    "- IGNORE length: a longer test is not better. Penalise added steps/asserts the SOURCE never made.",
    "- 'assertion-intent-preserved' = does the migration assert the SAME behaviours as the source",
    "  (none dropped/weakened/inverted)? This is about INTENT, not exact syntax.",
    "- Judge the code as written; do not assume a fix you can't see.",
    "",
    "## SOURCE test (the reference)",
    "```",
    sourceTest.trim().slice(0, 4000),
    "```",
    "",
    "## MIGRATED tree (spec + page objects)",
    "```ts",
    migratedTree.trim().slice(0, 8000),
    "```",
    "",
    "Respond with the JSON object only (and the 2-3 sentence summary before it).",
  ].join("\n");
}

/** Extract the {axis: score} JSON the judge emits (last JSON object in the text). */
export function parseScores(out: string): Record<Axis, number> | null {
  const matches = [...out.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]);
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(matches[i] ?? "") as Record<string, unknown>;
      if (AXES.every((a) => typeof obj[a] === "number")) {
        return Object.fromEntries(AXES.map((a) => [a, Number(obj[a])])) as Record<Axis, number>;
      }
    } catch { /* keep looking */ }
  }
  return null;
}

/** A migration is judge-ACCEPTABLE on the non-executable axes when no axis is
 * below 3 and assertion-intent is >= 4 (the load-bearing axis). */
export function verdictFromScores(scores: Record<Axis, number>): { acceptable: boolean; mean: number } {
  const vals = AXES.map((a) => scores[a]);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const acceptable = vals.every((v) => v >= 3) && scores["assertion-intent-preserved"] >= 4;
  return { acceptable, mean };
}

interface Auth { kind: "oauth" | "api" | "none"; value: string }
function detectAuth(): Auth {
  const oauth = (process.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  const api = (process.env["ANTHROPIC_API_KEY"] ?? "").trim();
  if (oauth.length > 0) return { kind: "oauth", value: oauth };
  if (api.length > 0) return { kind: "api", value: api };
  return { kind: "none", value: "" };
}

function runJudge(auth: Auth, prompt: string): string {
  const env = { ...process.env };
  if (auth.kind === "oauth") { env["CLAUDE_CODE_OAUTH_TOKEN"] = auth.value; delete env["ANTHROPIC_API_KEY"]; }
  else { env["ANTHROPIC_API_KEY"] = auth.value; delete env["CLAUDE_CODE_OAUTH_TOKEN"]; }
  // Judge with Opus (the stronger judge) in print mode; no edits. Capture stdout
  // (the scores are parsed from it); the shared runner bounds a hung call.
  const r = runClaudeCli(["--model", "claude-opus-4-8", "--print", prompt], { cwd: REPO_ROOT, env, capture: true });
  return r.stdout;
}

interface GoldRecord { input_basename: string; human_acceptable: boolean }

/** Calibrate: compare the judge's accept/reject to human labels with Cohen's kappa. */
function calibrate(goldPath: string): number {
  if (!existsSync(goldPath)) { process.stderr.write(`judge --calibrate: no gold set at ${goldPath}\n`); return 1; }
  const gold: GoldRecord[] = readFileSync(goldPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l) as GoldRecord);
  const auth = detectAuth();
  if (auth.kind === "none") { process.stderr.write("judge --calibrate needs Claude auth.\n"); return 1; }
  const humanV: boolean[] = [];
  const judgeV: boolean[] = [];
  for (const g of gold) {
    const spec = findGeneratedSpec(resolve(REPO_ROOT, "outputs/tests"), g.input_basename);
    if (!spec) continue;
    const scores = parseScores(runJudge(auth, buildJudgePrompt("(source unavailable in calibration)", collectEmittedSources(spec))));
    if (!scores) continue;
    humanV.push(g.human_acceptable);
    judgeV.push(verdictFromScores(scores).acceptable);
  }
  if (humanV.length < 2) { process.stderr.write("judge --calibrate: not enough labeled+scored items.\n"); return 1; }
  const k = cohensKappa(judgeV, humanV);
  process.stdout.write(`judge calibration: Cohen's kappa = ${k.kappa.toFixed(2)} (${kappaLabel(k.kappa)}), raw agreement ${(k.observedAgreement * 100).toFixed(0)}%, n=${k.n}\n`);
  process.stdout.write(k.kappa >= 0.6 ? "  ✓ >= 0.6 — the judge may gate unsupervised on the non-executable axes.\n" : "  ✗ < 0.6 — NOT calibrated enough; treat judge scores as advisory only.\n");
  return 0;
}

function main(): number {
  const { values } = parseArgs({
    options: { "input-basename": { type: "string" }, source: { type: "string" }, calibrate: { type: "string" } },
    strict: true,
  });
  if (values.calibrate) return calibrate(values.calibrate);
  const base = values["input-basename"];
  if (!base) { process.stderr.write("judge: --input-basename <base> (or --calibrate <gold.jsonl>) required.\n"); return 1; }
  const spec = findGeneratedSpec(resolve(REPO_ROOT, "outputs/tests"), base);
  if (!spec) { process.stderr.write(`judge: no spec for ${base}.\n`); return 1; }
  const source = values.source && existsSync(values.source) ? readFileSync(values.source, "utf8") : "(source test not provided)";
  const auth = detectAuth();
  if (auth.kind === "none") { process.stderr.write("judge needs Claude auth.\n"); return 1; }
  const prompt = buildJudgePrompt(source, collectEmittedSources(spec));
  const scores = parseScores(runJudge(auth, prompt));
  if (!scores) { process.stderr.write("judge: could not parse scores from the model.\n"); return 1; }
  const v = verdictFromScores(scores);
  process.stdout.write(`judge: ${relative(REPO_ROOT, spec)} — ${AXES.map((a) => `${a}=${scores[a]}`).join(" ")} | mean ${v.mean.toFixed(1)} | ${v.acceptable ? "ACCEPTABLE (non-exec axes)" : "needs review"} (across ${collectEmittedFiles(spec).length} files)\n`);
  return v.acceptable ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
