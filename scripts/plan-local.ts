#!/usr/bin/env tsx
/**
 * plan-local.ts — run Stage 1 (PLAN) locally, on YOUR own test file.
 *
 * Closes the adoptability dead-end the audit found (no-local-stage1): quickstart
 * told CI-averse users to `npm run migrate -- --input <their test>`, but Stage 2
 * hard-errors "no approved plan" because it requires a pre-existing
 * outputs/plans/<base>.md — and the only local plan producer (`try-it`) is
 * hard-wired to the bundled demo. So a new user had NO working end-to-end route
 * for their own test. This is the missing Stage-1 half:
 *
 *   npm run plan -- --input inputs/<framework>/foo.spec.ts   # writes outputs/plans/foo.spec.ts.md (+ envelope)
 *   npm run plan -- --input <path> --mock                    # wiring + cost preview, no Claude call
 *   npm run plan -- --check                                  # zero-token preflight doctor
 *
 * Then: npm run migrate -- --input <same path>   (Stage 2 uses the plan this produced).
 *
 * Exit codes: 0 = plan written + envelope validated; 1 = setup error or a gate failed.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { computeCostUsd } from "./metrics.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const ASSEMBLED_ANALYZE = join(REPO_ROOT, "prompts/_assembled/analyze.md");
const INVENTORY_PATH = join(REPO_ROOT, "outputs/.snippets-inventory.md");

interface Args { input: string; mock: boolean; check: boolean; help: boolean }
interface Auth { kind: "oauth" | "api" | "none"; value: string }
interface Paths { input: string; base: string; plan: string; envelope: string }

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      mock: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  return {
    input: values.input ?? "",
    mock: values.mock === true,
    check: values.check === true,
    help: values.help === true,
  };
}

function printHelp(): void {
  process.stdout.write([
    "",
    "plan — run Stage 1 (produce a migration PLAN) on your own test, locally.",
    "",
    "  npm run plan -- --input <path>          plan your test (needs auth)",
    "  npm run plan -- --input <path> --mock   wiring + cost preview, no Claude call",
    "  npm run plan -- --check                 zero-token preflight doctor",
    "",
    "Output: outputs/plans/<input-filename>.md + .envelope.json.",
    "Next:   npm run migrate -- --input <same path>   (Stage 2 reads this plan).",
    "",
  ].join("\n"));
}

export function derivePaths(args: Args): Paths {
  const input = resolve(REPO_ROOT, args.input);
  const base = basename(input);
  return {
    input,
    base,
    plan: join(REPO_ROOT, "outputs/plans", `${base}.md`),
    envelope: join(REPO_ROOT, "outputs/plans", `${base}.envelope.json`),
  };
}

function detectAuth(): Auth {
  const oauth = (process.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  const api = (process.env["ANTHROPIC_API_KEY"] ?? "").trim();
  if (oauth.length > 0) return { kind: "oauth", value: oauth };
  if (api.length > 0) return { kind: "api", value: api };
  return { kind: "none", value: "" };
}

function fail(msg: string): never {
  process.stderr.write(`\n  ERROR: ${msg}\n\n`);
  process.exit(1);
}

function preflight(args: Args): number {
  process.stdout.write("\n  plan --check (preflight)\n\n");
  const line = (ok: boolean, label: string, hint: string): boolean => {
    process.stdout.write(`    ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — ${hint}`}\n`);
    return ok;
  };
  const nodeMajor = Number((process.versions.node ?? "0").split(".")[0]);
  const nodeOk = line(nodeMajor >= 22, `Node ${process.versions.node} (need 22+)`, "install Node 22+ (nvm install 22)");
  const auth = detectAuth();
  const authOk = line(auth.kind !== "none", `Claude auth (${auth.kind})`, "set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) or ANTHROPIC_API_KEY");
  if (args.input) line(existsSync(derivePaths(args).input), `input ${args.input}`, "path not found");
  const ready = nodeOk && authOk;
  process.stdout.write(ready
    ? "\n  Ready. Run: npm run plan -- --input <your-test> (add --mock for a free wiring check).\n\n"
    : "\n  Not ready — fix the ✗ items above.\n\n");
  return ready ? 0 : 1;
}

/** Regenerate the assembled analyze prompt + reuse inventory, as plan.yml does. */
function prepareContext(): void {
  process.stdout.write("  [step] assemble prompts + build inventory ... ");
  execSync("npx tsx scripts/assemble-prompts.ts --write", { cwd: REPO_ROOT, stdio: "pipe" });
  execSync(`npx tsx scripts/build-inventory.ts --out ${JSON.stringify(INVENTORY_PATH)}`, { cwd: REPO_ROOT, stdio: "pipe" });
  process.stdout.write("ok\n");
}

export function buildPrompt(p: Paths): string {
  const inventory = existsSync(INVENTORY_PATH) ? readFileSync(INVENTORY_PATH, "utf8") : "";
  return [
    "You are running Stage 1 of the PWmodernizer pipeline (local plan run).",
    "",
    "Read prompts/_assembled/analyze.md — that is your full system prompt. Follow it exactly.",
    "",
    "## Input for this run",
    `- Source input: ${p.input}`,
    `- Output plan path: ${p.plan}`,
    `- Output envelope path: ${p.envelope}`,
    "",
    "## Context to load (in order)",
    "1. prompts/_assembled/analyze.md — your task spec (READ FIRST)",
    "2. config/migration-rules.md — style + structure contract",
    "3. config/knowledge-base.md — anti-pattern + API translations (use ONLY existing KB-IDs)",
    `4. ${p.input} — the source to analyse`,
    "",
    "## Existing project surface — reuse before inventing",
    inventory,
    "",
    "## Deliverables",
    `- Write the plan markdown to ${p.plan} (the analyze.md contract).`,
    `- Write the plan envelope JSON to ${p.envelope} (the dual-output mandate).`,
    "- Do NOT invent KB-IDs. Do NOT write anywhere except those two paths.",
  ].join("\n");
}

function runClaude(auth: Auth, prompt: string): void {
  const billedTo = auth.kind === "oauth" ? "Claude subscription" : "Anthropic API key";
  process.stdout.write(`  ⚠ This calls Claude (model claude-sonnet-4-6, up to 30 turns) and spends tokens on your ${billedTo}.\n`);
  process.stdout.write("  [step] call Claude (Stage 1, claude-sonnet-4-6, max-turns 30) ... ");
  const env = { ...process.env };
  if (auth.kind === "oauth") { env["CLAUDE_CODE_OAUTH_TOKEN"] = auth.value; delete env["ANTHROPIC_API_KEY"]; }
  else { env["ANTHROPIC_API_KEY"] = auth.value; delete env["CLAUDE_CODE_OAUTH_TOKEN"]; }
  const r = spawnSync("npx", [
    "--yes", "@anthropic-ai/claude-code",
    "--model", "claude-sonnet-4-6",
    "--max-turns", "30",
    "--print",
    "--permission-mode", "acceptEdits",
    prompt,
  ], { cwd: REPO_ROOT, env, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) fail("Claude plan call failed — see output above.");
  process.stdout.write("  [step] Claude plan done\n");
}

/** Estimate the Stage-1 INPUT cost from the assembled-prompt size (a floor). */
function estimateInputCostUsd(p: Paths, prompt: string): { tokens: number; usd: number } {
  const read = (path: string): number => (existsSync(path) ? readFileSync(path, "utf8").length : 0);
  let chars = prompt.length;
  for (const f of [ASSEMBLED_ANALYZE, join(REPO_ROOT, "config/migration-rules.md"), join(REPO_ROOT, "config/knowledge-base.md"), p.input]) {
    chars += read(f);
  }
  const tokens = Math.ceil(chars / 4);
  return { tokens, usd: computeCostUsd({ model: "claude-sonnet-4-6", input_tokens: tokens, output_tokens: 0 }) ?? 0 };
}

/** Derive + schema-validate the envelope after the plan is written. */
function validateEnvelope(p: Paths): boolean {
  if (!existsSync(p.envelope)) {
    process.stdout.write("  [step] derive envelope from plan ... ");
    const d = spawnSync("npx", ["tsx", "scripts/derive-envelope.ts", "--plan", p.plan, "--out", p.envelope], { cwd: REPO_ROOT, encoding: "utf8" });
    process.stdout.write(d.status === 0 ? "ok\n" : "FAILED\n");
    if (d.status !== 0) { process.stderr.write(d.stderr ?? ""); return false; }
  }
  process.stdout.write("  [gate] validate plan envelope ... ");
  const v = spawnSync("npx", ["tsx", "scripts/plan-envelope-validate.ts", "--envelope", p.envelope], { cwd: REPO_ROOT, encoding: "utf8" });
  process.stdout.write(v.status === 0 ? "ok\n" : "FAILED\n");
  if (v.status !== 0) process.stderr.write(`${v.stdout ?? ""}${v.stderr ?? ""}`);
  return v.status === 0;
}

function main(): number {
  const args = parseCliArgs();
  if (args.help) { printHelp(); return 0; }
  if (args.check) return preflight(args);
  if (!args.input) { printHelp(); fail("--input <path> is required."); }

  const p = derivePaths(args);
  if (!existsSync(p.input)) fail(`input not found: ${p.input}`);
  for (const d of [dirname(p.plan)]) mkdirSync(d, { recursive: true });

  process.stdout.write(`\n  plan — ${p.base}\n\n`);
  prepareContext();
  const prompt = buildPrompt(p);

  if (args.mock) {
    const { tokens, usd } = estimateInputCostUsd(p, prompt);
    process.stdout.write("\n  [mock] wiring OK. Would invoke:\n");
    process.stdout.write("    npx @anthropic-ai/claude-code --model claude-sonnet-4-6 --max-turns 30 --print --permission-mode acceptEdits \"<stage-1 prompt>\"\n");
    process.stdout.write(`  [mock] cost preview (Stage 1 input): ~${tokens.toLocaleString()} tokens, ~$${usd.toFixed(2)} at Sonnet rates (floor; excludes output + turns)\n`);
    process.stdout.write(`  [mock] would write: ${p.plan} + ${p.envelope}\n`);
    process.stdout.write("\n  Re-run without --mock (with auth set) to produce the plan.\n\n");
    return 0;
  }

  const auth = detectAuth();
  if (auth.kind === "none") fail("no Claude auth. Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY (see --help). Or --mock to check wiring.");
  runClaude(auth, prompt);

  if (!existsSync(p.plan)) fail(`Claude did not write the plan at ${p.plan}.`);
  const ok = validateEnvelope(p);
  process.stdout.write(ok
    ? `\n  Plan ready: ${p.plan}\n  Next: npm run migrate -- --input ${args.input}\n\n`
    : "\n  Plan written but the envelope gate failed — review above before Stage 2.\n\n");
  return ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
