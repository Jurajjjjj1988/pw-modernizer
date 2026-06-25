#!/usr/bin/env tsx
/**
 * run-against-sut.ts — execution-based acceptance gate (the #1 prior-art lever).
 *
 * Every mature migration/codegen system (SWE-bench, Aider, Amazon Q, Copilot
 * modernization, Devin) defines "the output is good" as: it RUNS GREEN against
 * the real application, and doesn't regress the rest of the suite. We only ever
 * static-gated (tsc/eslint/conformance), which proves a test COMPILES, not that
 * it WORKS. This closes that gap: it runs the migrated spec against a live SUT
 * and reports the SWE-bench-style verdict.
 *
 * It resolves the spec generated for an input (by basename, the shared resolver),
 * runs `playwright test` against MIGRATION_TARGET_URL (the existing
 * outputs/tests/playwright.config.ts reads baseURL from that env), and on failure
 * captures the error tail so a repair loop (Self-Debug / Aider style) can feed it
 * back to Claude.
 *
 *   npx tsx scripts/run-against-sut.ts --input-basename saucedemo-login.cy.js --url https://www.saucedemo.com
 *
 * Exit codes: 0 = ran GREEN (accepted); 1 = ran but FAILED (needs repair);
 *             2 = could not run (no spec / no url / playwright missing).
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { findGeneratedSpec } from "./output-spec.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

interface SutResult {
  ran: boolean;
  passed: boolean;
  /** Trimmed failure output for a repair prompt (empty when green). */
  failureTail: string;
  specRel: string;
}

/**
 * Parse a Playwright run's combined output + exit status into a verdict. Pure
 * (no process spawn) so the gate's accept/reject/can't-run logic is unit-tested.
 * "ran but failed" must be distinguished from "could not run at all" (missing
 * browser/config) — the former feeds the repair loop, the latter is an infra error.
 */
export function parsePlaywrightVerdict(out: string, status: number | null): { ran: boolean; passed: boolean } {
  const hasTally = /\d+\s+passed|\d+\s+failed/i.test(out);
  const infraError = /command not found|Cannot find module|No tests found|Executable doesn't exist|browserType\.launch/i.test(out);
  if (infraError && !hasTally) return { ran: false, passed: false };
  const passed = status === 0 && /\bpassed\b/i.test(out) && !/\bfailed\b/i.test(out);
  return { ran: true, passed };
}

/** Run the spec against the SUT and parse the pass/fail verdict. */
export function runSpecAgainstSut(spec: string, url: string, project = "chromium"): SutResult {
  const specRel = relative(REPO_ROOT, spec);
  const r = spawnSync(
    "npx",
    ["playwright", "test", spec, "--project", project, "--reporter=line", "--retries=0"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, MIGRATION_TARGET_URL: url },
      timeout: 180_000,
    },
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const v = parsePlaywrightVerdict(out, r.status);
  if (!v.ran) return { ran: false, passed: false, failureTail: out.split("\n").slice(-25).join("\n"), specRel };
  return { ran: true, passed: v.passed, failureTail: v.passed ? "" : out.split("\n").slice(-40).join("\n"), specRel };
}

function main(): never {
  const { values } = parseArgs({
    options: {
      "input-basename": { type: "string" },
      spec: { type: "string" },
      url: { type: "string" },
      "out-dir": { type: "string", default: "outputs/tests" },
      "failure-out": { type: "string" },
      project: { type: "string", default: "chromium" },
    },
    strict: true,
  });
  const url = values.url ?? process.env["MIGRATION_TARGET_URL"] ?? "";
  if (!url) {
    process.stderr.write("run-against-sut: --url <sut> (or MIGRATION_TARGET_URL) is required — the gate runs the test against a LIVE app.\n");
    process.exit(2);
  }
  let spec = values.spec ?? "";
  if (!spec && values["input-basename"]) {
    spec = findGeneratedSpec(resolve(REPO_ROOT, values["out-dir"] ?? "outputs/tests"), values["input-basename"]) ?? "";
  }
  if (!spec || !existsSync(spec)) {
    process.stderr.write(`run-against-sut: no spec resolved (spec='${spec}'). Pass --spec or --input-basename.\n`);
    process.exit(2);
  }

  process.stdout.write(`run-against-sut: running ${relative(REPO_ROOT, spec)} against ${url} ...\n`);
  const res = runSpecAgainstSut(spec, url, values.project ?? "chromium");

  if (!res.ran) {
    process.stderr.write(`::warning::run-against-sut: could not execute the spec (browser/config). Tail:\n${res.failureTail}\n`);
    process.exit(2);
  }
  if (res.passed) {
    process.stdout.write(`✅ ACCEPTED — ${res.specRel} runs GREEN against ${url}. This is the strongest acceptance signal: the migrated test actually works.\n`);
    process.exit(0);
  }
  // Persist the failure tail for a repair loop.
  const failOut = values["failure-out"] ?? `outputs/reports/${(values["input-basename"] ?? "spec").replace(/[^\w.-]/g, "_")}-sut-failure.txt`;
  mkdirSync(dirname(resolve(REPO_ROOT, failOut)), { recursive: true });
  writeFileSync(resolve(REPO_ROOT, failOut), res.failureTail);
  process.stderr.write(
    `::error::run-against-sut: ${res.specRel} FAILED against ${url}. The migration compiles but does not work on the real app — ` +
      `feed ${failOut} + a fresh aria snapshot back to Stage 2 for repair (Self-Debug/Aider loop).\nTail:\n${res.failureTail}\n`,
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
