#!/usr/bin/env tsx
/**
 * flake-rate.ts — repeat-each flake gate (deterministic-green guard).
 *
 * A single green run proves a spec CAN pass; it does not prove the spec passes
 * RELIABLY. A migrated test that is green once but flaky (timing-dependent waits,
 * order-coupled state, racy selectors) is exactly the failure the pipeline exists
 * to migrate AWAY from — yet a one-shot `run-against-sut` accepts it. This gate
 * runs the SAME spec N times in ONE playwright process via `--repeat-each=N` and
 * accepts ONLY when ALL N repetitions pass (zero failed / flaky / interrupted /
 * did-not-run, and at least N real passes).
 *
 * It REUSES the proven `parsePlaywrightVerdict` from run-against-sut.ts for the
 * per-bucket tally semantics, then adds the flake-specific constraint that the
 * pass count covers every repetition (`passedN >= n`). Because `--repeat-each`
 * multiplies every matched test, the combined tally stays a SINGLE line, so
 * `passedN >= n && failedN === 0 && flakyN === 0` cleanly discriminates an
 * all-pass run from a coin-flip one.
 *
 * Gated behind env PWM_FLAKE_RUNS (DEFAULT 1): with N=1 this is byte-for-byte the
 * current single-run cost/behaviour — it CANNOT regress the proven greens or the
 * calibrate corpus. Wiring it into migrate-local / repair-loop is deliberately
 * deferred to a token-spending live run; this change ships only the unit-proven
 * core + CLI + npm script.
 *
 *   PWM_FLAKE_RUNS=5 npx tsx scripts/flake-rate.ts --spec outputs/tests/foo.spec.ts --url https://example.com
 *
 * Exit codes: 0 = ran GREEN on ALL N (accepted); 1 = ran but at least one rep
 *             failed/flaked (needs repair); 2 = could not run (no spec/url/browser).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parsePlaywrightVerdict } from "./run-against-sut.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

export interface FlakeVerdict {
  /** The run executed (vs. an infra error — missing browser/config/spec). */
  ran: boolean;
  /** ALL n repetitions passed deterministically (the only accept signal). */
  green: boolean;
  /** Real passes counted in the combined tally (for diagnostics). */
  passedN: number;
}

/**
 * Read the integer repeat count from env PWM_FLAKE_RUNS. Defaults to 1 (the
 * current single-run behaviour) and floors any non-positive / non-numeric value
 * to 1, so a malformed env var can never silently disable the gate or run zero
 * reps. Exported pure so the CLI's count is unit-pinnable.
 */
export function flakeRunsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["PWM_FLAKE_RUNS"];
  if (raw === undefined || raw === "") return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Pure verdict for an N-repetition Playwright run. Delegates the tally semantics
 * (skipped/flaky/interrupted/did-not-run all disqualify; ≥1 real pass required;
 * infra-error vs. ran) to the proven `parsePlaywrightVerdict`, then layers the
 * flake-specific rule: GREEN requires the pass count to cover EVERY repetition
 * (`passedN >= n`). A coin-flip run reports `… flaky` (or a `failed` bucket), so
 * its base verdict is already `passed:false` and this returns green:false.
 */
export function flakeVerdict(out: string, status: number | null, n: number): FlakeVerdict {
  const reps = Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
  const base = parsePlaywrightVerdict(out, status);
  const m = /(\d+)\s+passed/i.exec(out);
  const passedN = m ? Number(m[1]) : 0;
  if (!base.ran) return { ran: false, green: false, passedN };
  const green = base.passed && passedN >= reps;
  return { ran: true, green, passedN };
}

interface FlakeRunResult {
  ran: boolean;
  green: boolean;
  passedN: number;
  reps: number;
  failureTail: string;
  specRel: string;
}

/** Find the playwright.config.ts governing a spec (walk up from its dir), mirroring
 * run-against-sut.ts — the generated config lives at outputs/tests/playwright.config.ts. */
function findPlaywrightConfig(spec: string): string | null {
  let dir = dirname(resolve(spec));
  for (let i = 0; i < 6; i++) {
    const cfg = join(dir, "playwright.config.ts");
    if (existsSync(cfg)) return cfg;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** Run the spec N times in ONE playwright process via --repeat-each and grade it. */
export function runFlakeAgainstSut(spec: string, url: string, reps: number, project = "chromium"): FlakeRunResult {
  const specRel = relative(REPO_ROOT, spec);
  const config = findPlaywrightConfig(spec);
  const args = [
    "playwright", "test", spec,
    "--project", project,
    "--reporter=line",
    "--retries=0",
    `--repeat-each=${reps}`,
  ];
  if (config) args.push("--config", config);
  const r = spawnSync("npx", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, MIGRATION_TARGET_URL: url },
    timeout: 300_000,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const v = flakeVerdict(out, r.status, reps);
  if (!v.ran) return { ran: false, green: false, passedN: v.passedN, reps, failureTail: out.split("\n").slice(-25).join("\n"), specRel };
  return { ran: true, green: v.green, passedN: v.passedN, reps, failureTail: v.green ? "" : out.split("\n").slice(-40).join("\n"), specRel };
}

function main(): never {
  const { values } = parseArgs({
    options: {
      spec: { type: "string" },
      url: { type: "string" },
      project: { type: "string", default: "chromium" },
    },
    strict: true,
  });
  const url = values.url ?? process.env["MIGRATION_TARGET_URL"] ?? "";
  if (!url) {
    process.stderr.write("flake-rate: --url <sut> (or MIGRATION_TARGET_URL) is required — the gate runs the test against a LIVE app.\n");
    process.exit(2);
  }
  const spec = values.spec ?? "";
  if (!spec || !existsSync(spec)) {
    process.stderr.write(`flake-rate: no spec resolved (spec='${spec}'). Pass --spec.\n`);
    process.exit(2);
  }
  const reps = flakeRunsFromEnv();
  process.stdout.write(`flake-rate: running ${relative(REPO_ROOT, spec)} ×${reps} (--repeat-each) against ${url} ...\n`);
  const res = runFlakeAgainstSut(spec, url, reps, values.project ?? "chromium");

  if (!res.ran) {
    process.stderr.write(`::warning::flake-rate: could not execute the spec (browser/config). Tail:\n${res.failureTail}\n`);
    process.exit(2);
  }
  if (res.green) {
    process.stdout.write(`✅ STABLE — ${res.specRel} ran GREEN on all ${reps}/${reps} repetitions against ${url}.\n`);
    process.exit(0);
  }
  process.stderr.write(
    `::error::flake-rate: ${res.specRel} is FLAKY/failing across ${reps} repetitions (passed=${res.passedN}). ` +
      `The migration is not deterministically green — feed the failure back to Stage 2 for repair.\nTail:\n${res.failureTail}\n`,
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
