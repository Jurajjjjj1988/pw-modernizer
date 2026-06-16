#!/usr/bin/env node
/**
 * capture-failure.ts — freeze a failing migrator PR into a local fixture and
 * print a compact triage digest. ZERO Claude tokens.
 *
 * Why this exists: the expensive way to debug a pipeline failure is to re-run
 * `migrate.yml` + `verify.yml` in CI (burns Sonnet plan+migrate + Opus verify).
 * Almost every infra fix (parser, validator, ESLint rule, YAML, max-turns) is
 * deterministic and needs NO LLM. This tool captures the LLM output ONCE so the
 * fix can be tested locally against the frozen artifact as many times as needed,
 * and the fixture stays behind as a permanent regression case.
 *
 * What it does (all via `gh`, no LLM calls):
 *   1. read the migrator PR (labels, files, title)
 *   2. fetch the generated files from the PR branch (spec, page objects, report)
 *   3. read the source input from the local checkout
 *   4. parse the verify report for the failure signature
 *   5. auto-detect deterministic anomalies (filename drift, low plan confidence,
 *      residual smells, forbidden patterns)
 *   6. write everything under tools/calibrate-pipeline/fixtures/_captured/<slug>/
 *   7. print a ~20-line DIGEST + suggested local replay commands
 *
 * Run:
 *   npx tsx scripts/capture-failure.ts <pr-number>
 *   npx tsx scripts/capture-failure.ts 126
 *
 * Exit codes: 0 = captured, 1 = capture failed (PR missing, gh error).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CAPTURE_ROOT = join(
  REPO_ROOT, "tools", "calibrate-pipeline", "fixtures", "_captured",
);

interface PrFile { path: string }
interface PrLabel { name: string }
interface PrMeta {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  labels: PrLabel[];
  files: PrFile[];
}

/** A single deterministic red flag surfaced from the report or file names. */
export interface Anomaly { kind: string; detail: string }

/** Everything the digest needs, derived without reading the full CI log. */
interface Digest {
  pr: number;
  url: string;
  branch: string;
  title: string;
  labels: string[];
  verdict: string;
  sourceInput: string | null;
  outputSpec: string | null;
  aggregateConfidence: string | null;
  planConfidence: string | null;
  anomalies: Anomaly[];
  replayCommands: string[];
}

function parseCliArgs(): { pr: number } {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });
  const pr = Number(positionals[0]);
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error("usage: npx tsx scripts/capture-failure.ts <pr-number>");
    process.exit(1);
  }
  return { pr };
}

/** Run `gh` and return stdout, or exit with a clear message on failure. */
function gh(args: string[]): string {
  const res = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    console.error(`gh ${args.join(" ")} failed:\n${res.stderr ?? ""}`);
    process.exit(1);
  }
  return res.stdout;
}

/** `owner/repo` of the current checkout, for contents API calls. */
function repoSlug(): string {
  return gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
}

function fetchPrMeta(pr: number): PrMeta {
  const raw = gh([
    "pr", "view", String(pr),
    "--json", "number,title,headRefName,url,labels,files",
  ]);
  return JSON.parse(raw) as PrMeta;
}

/** Fetch one file's text from the PR branch; null if it does not exist there. */
function fetchFileAtRef(slug: string, path: string, ref: string): string | null {
  const res = spawnSync(
    "gh",
    ["api", `repos/${slug}/contents/${path}?ref=${ref}`, "--jq", ".content"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) return null;
  const b64 = res.stdout.trim();
  if (!b64) return null;
  return Buffer.from(b64, "base64").toString("utf8");
}

/** The verify verdict, read from labels (verify:ship-it / fix-first / start-over). */
export function verdictFromLabels(labels: string[]): string {
  const v = labels.filter((l) => l.startsWith("verify:"));
  const sole = v[0];
  if (sole === undefined) return "UNKNOWN";
  if (v.length > 1) {
    return `CONFLICT(${v.map((l) => l.replace("verify:", "")).join(" + ")})`;
  }
  return sole.replace("verify:", "").toUpperCase().replaceAll("-", " ");
}

/**
 * Stale-label conflicts: re-running verify on a PR adds a new verdict without
 * removing the old one, so verify:* and confidence:* siblings accumulate. This
 * misleads reviewers and babysit.sh auto-merge. Deterministic — fix in verify.yml.
 */
export function labelConflicts(labels: string[]): Anomaly[] {
  const out: Anomaly[] = [];
  const verdicts = labels.filter((l) => l.startsWith("verify:"));
  if (verdicts.length > 1) {
    out.push({ kind: "conflicting-verdict-labels", detail: verdicts.join(" + ") });
  }
  if (labels.includes("confidence:low") && labels.includes("confidence:high")) {
    out.push({ kind: "conflicting-confidence-labels", detail: "confidence:low + confidence:high" });
  }
  return out;
}

/** Pull `inputs/...` source path out of the PR title. */
function sourceInputFromTitle(title: string): string | null {
  const m = title.match(/inputs\/\S+/);
  return m ? m[0] : null;
}

/** First capture group of the first matching line, or null. */
function grab(report: string, re: RegExp): string | null {
  const v = re.exec(report)?.[1];
  return v === undefined ? null : v.trim();
}

/**
 * Filename drift: output spec names a different feature than the source
 * (e.g. wishlist -> search-filters). Compare on a separator-free normal form so
 * camelCase Java (AddCookiesJupiterTest) and kebab-case TS
 * (add-cookies-jupiter-test) read as identical, and a dropped suffix
 * (AddCookiesJupiterTest -> add-cookies) still counts as a containment match.
 */
export function filenameDrift(sourceInput: string | null, outputSpec: string | null): Anomaly[] {
  if (!sourceInput || !outputSpec) return [];
  const srcStem = basename(sourceInput).replace(/\.(cy|spec)?\.?\w+$/i, "");
  const outStem = basename(outputSpec).replace(/\.spec\.ts$/i, "");
  const norm = (s: string): string => s.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
  const srcN = norm(srcStem);
  const outN = norm(outStem);
  const related = srcN.length > 0 && outN.length > 0
    && (srcN.includes(outN) || outN.includes(srcN));
  return related ? [] : [{
    kind: "filename-drift",
    detail: `source "${srcStem}" vs output "${outStem}" name different features`,
  }];
}

/** Scan the verify report markdown for low plan confidence, residual smells, forbidden patterns. */
export function scanReport(report: string | null): Anomaly[] {
  if (!report) return [];
  const out: Anomaly[] = [];
  const planAvg = grab(report, /Plan confidence:[^\n]*avg\s*([\d.]+)/i);
  if (planAvg && Number(planAvg) < 0.5) {
    out.push({ kind: "low-plan-confidence", detail: `plan avg ${planAvg} (< 0.5)` });
  }
  // Residual smells: any "Output" column > 0 in the smell table (delta not fully removed).
  // nonWebFirstAsserts is exempt from the "fix locally" residual-smell class: the
  // prompt (generate.md) explicitly sanctions expect().toBe() on event/API VALUES
  // (dialog.message(), cookie values) that are not Locator probes, so a non-zero
  // count is usually legitimate — recurs as triage noise on selenium PRs (#151, #13).
  // Demote it to a non-blocking review-note; all other smells stay residual-smell.
  for (const line of report.split("\n")) {
    const m = /^\|\s*(\w+)\s*\|\s*\d+\s*\|\s*([1-9]\d*)\s*\|/.exec(line);
    if (!m) continue;
    if (m[1] === "nonWebFirstAsserts") {
      out.push({ kind: "review-note", detail: `nonWebFirstAsserts ${m[2]} in output — confirm each is a prompt-sanctioned event/API value-assert, not a Locator probe` });
    } else {
      out.push({ kind: "residual-smell", detail: `${m[1]} still ${m[2]} in output` });
    }
  }
  if (/Forbidden patterns in output[\s\S]*?❌/.test(report)) {
    out.push({ kind: "forbidden-pattern", detail: "report flags forbidden patterns present" });
  }
  return out;
}

/**
 * Deterministic anomaly scan over the report + file names. These are the
 * signatures that usually explain a START OVER / FIX FIRST without needing the
 * CI log at all.
 */
export function detectAnomalies(
  report: string | null,
  sourceInput: string | null,
  outputSpec: string | null,
): Anomaly[] {
  return [
    ...filenameDrift(sourceInput, outputSpec),
    ...scanReport(report),
  ];
}

/** Suggested zero-token local replay commands, chosen from the source framework. */
function replayCommands(sourceInput: string | null, captureDir: string): string[] {
  const cmds = [
    "npm run smoke            # typecheck + validate:all + lint (zero tokens)",
  ];
  if (sourceInput?.includes("cypress")) {
    cmds.push("npm run calibrate -- --validator cypress-conformance");
  } else if (sourceInput?.includes("selenium-python")) {
    cmds.push("npm run calibrate -- --validator selenium-python-conformance");
  } else if (sourceInput?.includes("selenium-java")) {
    cmds.push("npm run calibrate -- --validator selenium-java-conformance");
  }
  cmds.push(`# frozen artifact: ${captureDir}`);
  return cmds;
}

function slugFor(meta: PrMeta): string {
  const src = sourceInputFromTitle(meta.title);
  const stem = src ? basename(src).replace(/\.\w+$/, "") : `pr-${meta.number}`;
  return `pr${meta.number}-${stem}`.replaceAll(/[^a-zA-Z0-9._-]/g, "-");
}

function main(): void {
  const { pr } = parseCliArgs();
  const slug = repoSlug();
  const meta = fetchPrMeta(pr);
  const labels = meta.labels.map((l) => l.name);
  const captureSlug = slugFor(meta);
  const captureDir = join(CAPTURE_ROOT, captureSlug);
  mkdirSync(captureDir, { recursive: true });

  // 1. Freeze generated files from the PR branch.
  const generated = meta.files.filter((f) => f.path.startsWith("outputs/"));
  let report: string | null = null;
  let outputSpec: string | null = null;
  for (const f of generated) {
    const content = fetchFileAtRef(slug, f.path, meta.headRefName);
    if (content === null) continue;
    const flat = f.path.replace(/^outputs\//, "").replace(/\//g, "__");
    writeFileSync(join(captureDir, flat), content);
    if (f.path.startsWith("outputs/reports/")) report = content;
    if (f.path.startsWith("outputs/tests/")) outputSpec = f.path;
  }

  // 2. Freeze the source input from the local checkout.
  const sourceInput = sourceInputFromTitle(meta.title);
  if (sourceInput && existsSync(join(REPO_ROOT, sourceInput))) {
    const ext = extname(sourceInput) || ".txt";
    writeFileSync(
      join(captureDir, `input${ext}`),
      readFileSync(join(REPO_ROOT, sourceInput), "utf8"),
    );
  }

  // 3. Build digest.
  const digest: Digest = {
    pr: meta.number,
    url: meta.url,
    branch: meta.headRefName,
    title: meta.title,
    labels,
    verdict: verdictFromLabels(labels),
    sourceInput,
    outputSpec,
    aggregateConfidence: report ? grab(report, /Aggregate confidence:\*\*\s*([\d.]+)/i) : null,
    planConfidence: report ? grab(report, /Plan confidence:[^\n]*avg\s*([\d.]+)/i) : null,
    anomalies: [
      ...labelConflicts(labels),
      ...detectAnomalies(report, sourceInput, outputSpec),
    ],
    replayCommands: replayCommands(sourceInput, captureDir),
  };
  writeFileSync(join(captureDir, "meta.json"), JSON.stringify(digest, null, 2));

  // 4. Human-readable digest.
  const lines: string[] = [
    `# Triage digest — PR #${digest.pr}`,
    "",
    `- ${digest.title}`,
    `- verdict: **${digest.verdict}**   labels: ${digest.labels.join(", ")}`,
    `- source: ${digest.sourceInput ?? "?"}  →  output: ${digest.outputSpec ?? "?"}`,
    `- confidence: aggregate ${digest.aggregateConfidence ?? "?"} | plan avg ${digest.planConfidence ?? "?"}`,
    "",
    "## Anomalies (deterministic — fix locally, no cloud)",
    ...(digest.anomalies.length
      ? digest.anomalies.map((a) => `- [${a.kind}] ${a.detail}`)
      : ["- none auto-detected — read frozen report.md"]),
    "",
    "## Replay locally (zero tokens)",
    ...digest.replayCommands.map((c) => `  ${c}`),
    "",
  ];
  const digestText = lines.join("\n");
  writeFileSync(join(captureDir, "DIGEST.md"), digestText);
  process.stdout.write(`${digestText}\nFrozen → ${captureDir}\n`);
}

// Only run the CLI when invoked directly — importing for tests must not fetch PRs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
