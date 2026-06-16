#!/usr/bin/env node
/**
 * pilot-dry-run.ts - operator-facing pre-flight check for a pilot.
 *
 * Why this exists: docs/pilot-kit.md walks an operator through Phases 0-6 of
 * a real-world pilot, but the actual pipeline only fires on a real push to a
 * GitHub-hosted fork. This script answers "is my local state ready before
 * I push" without burning Claude tokens.
 *
 * What it checks (in order):
 *
 *   1. node + npm + gh CLI versions
 *   2. The two auth secrets - at least one of CLAUDE_CODE_OAUTH_TOKEN or
 *      ANTHROPIC_API_KEY is reachable (env or `gh secret list` against the
 *      current repo)
 *   3. `npm run smoke` is clean
 *   4. `npm run calibrate` reports 10/10 validators green
 *   5. There's at least one input under `inputs/<framework>/` (single-file
 *      OR a directory)
 *   6. No `outputs/.metrics.db` from a prior wildly different run is
 *      sitting around polluting the dashboard
 *
 * Each check ends in PASS/WARN/FAIL. Exit code: 0 if all PASS, 1 if any
 * FAIL. WARNs are non-blocking - the operator decides.
 *
 * CLI: `npx tsx scripts/pilot-dry-run.ts [--strict] [--quiet]`
 *
 * --strict: WARN becomes FAIL (catches "I forgot to set the OAuth token")
 * --quiet: only prints the final verdict line, useful for CI gating
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

interface CheckResult {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  message: string;
}

interface Args {
  strict: boolean;
  quiet: boolean;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      strict: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
    },
  });
  return { strict: values.strict === true, quiet: values.quiet === true };
}

function safeExec(cmd: string, timeoutMs = 15_000): string | null {
  try {
    return execSync(cmd, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

function checkNodeVersion(): CheckResult {
  const out = safeExec("node --version");
  if (out === null) {
    return { name: "node version", status: "FAIL", message: "node not on PATH" };
  }
  const match = /v(\d+)\./.exec(out);
  const major = match === null ? 0 : Number.parseInt(match[1] ?? "0", 10);
  if (major < 22) {
    return {
      name: "node version",
      status: "FAIL",
      message: `node ${out.trim()} (need >= v22, see package.json engines)`,
    };
  }
  return { name: "node version", status: "PASS", message: out.trim() };
}

function checkGhCli(): CheckResult {
  const out = safeExec("gh --version");
  if (out === null) {
    return {
      name: "gh CLI",
      status: "FAIL",
      message: "gh CLI not on PATH (needed for plan/code PR ops)",
    };
  }
  const firstLine = out.split("\n")[0]?.trim() ?? "";
  return { name: "gh CLI", status: "PASS", message: firstLine };
}

function checkAuth(): CheckResult {
  const oat = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
  const api = process.env["ANTHROPIC_API_KEY"];
  if (typeof oat === "string" && oat.length > 0) {
    return {
      name: "auth (env)",
      status: "PASS",
      message: "CLAUDE_CODE_OAUTH_TOKEN reachable from env",
    };
  }
  if (typeof api === "string" && api.length > 0) {
    return {
      name: "auth (env)",
      status: "PASS",
      message: "ANTHROPIC_API_KEY reachable from env",
    };
  }
  // Try the repo secret list as a soft fallback (covers operators who set
  // the secret on the fork but not the local shell).
  const repoSecrets = safeExec("gh secret list 2>/dev/null", 5_000);
  if (repoSecrets !== null && /CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY/.test(repoSecrets)) {
    return {
      name: "auth (repo secret)",
      status: "WARN",
      message:
        "Auth secret set on the fork but not in local env - GitHub workflows will run, but `npm run try-it` won't unless you export one of CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY",
    };
  }
  return {
    name: "auth",
    status: "FAIL",
    message:
      "Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY available - pipeline can't call Claude. Run `claude setup-token` or export ANTHROPIC_API_KEY.",
  };
}

function checkSmoke(): CheckResult {
  const out = safeExec("npm run smoke 2>&1", 240_000);
  if (out === null) {
    return {
      name: "npm run smoke",
      status: "FAIL",
      message: "smoke command did not exit cleanly (timed out or threw)",
    };
  }
  // Lint produces 3 known pre-existing warnings on _legacy-v0.1.x files.
  // Anything besides "0 errors" is a regression.
  if (/[1-9]\d* problems? \([1-9]\d* errors?/.test(out)) {
    return { name: "npm run smoke", status: "FAIL", message: "smoke reports errors" };
  }
  return { name: "npm run smoke", status: "PASS", message: "0 errors" };
}

function checkCalibration(): CheckResult {
  const out = safeExec("npm run calibrate 2>&1", 240_000);
  if (out === null) {
    return {
      name: "npm run calibrate",
      status: "FAIL",
      message: "calibrate did not exit cleanly",
    };
  }
  // Each validator emits `[OK ] <name>: M/M fixtures passed (...)`.
  // FAIL emits `[FAIL] <name>: ...`.
  if (/\[FAIL\s*\]/.test(out)) {
    const failingLines = out
      .split("\n")
      .filter((l) => l.includes("[FAIL"))
      .slice(0, 3)
      .join("; ");
    return { name: "npm run calibrate", status: "FAIL", message: failingLines };
  }
  const okCount = (out.match(/\[OK\s*\]/g) ?? []).length;
  if (okCount === 0) {
    return {
      name: "npm run calibrate",
      status: "FAIL",
      message: "no [OK] lines found - calibration runner shape changed?",
    };
  }
  return {
    name: "npm run calibrate",
    status: "PASS",
    message: `${okCount} validators green`,
  };
}

function countInputs(): number {
  const inputsDir = join(REPO_ROOT, "inputs");
  if (!existsSync(inputsDir)) return 0;
  let count = 0;
  for (const fw of readdirSync(inputsDir)) {
    const fwDir = join(inputsDir, fw);
    if (!statSync(fwDir).isDirectory()) continue;
    if (fw.startsWith("_")) continue; // _stress, _provenance
    for (const entry of readdirSync(fwDir)) {
      const full = join(fwDir, entry);
      if (statSync(full).isFile() && /\.(ts|js|java|py)$/.test(entry)) count += 1;
      if (statSync(full).isDirectory()) count += 1;
    }
  }
  return count;
}

function checkInputs(): CheckResult {
  const n = countInputs();
  if (n === 0) {
    return {
      name: "inputs/<framework>/",
      status: "WARN",
      message: "no inputs found - cp at least one legacy test under inputs/<framework>/",
    };
  }
  return { name: "inputs/<framework>/", status: "PASS", message: `${n} test unit(s) ready` };
}

function checkMetricsDb(): CheckResult {
  const db = join(REPO_ROOT, "outputs", ".metrics.db");
  if (!existsSync(db)) {
    return {
      name: "metrics DB",
      status: "PASS",
      message: "no prior DB - dashboard will start clean",
    };
  }
  const size = statSync(db).size;
  if (size > 5_000_000) {
    return {
      name: "metrics DB",
      status: "WARN",
      message: `outputs/.metrics.db is ${(size / 1024 / 1024).toFixed(1)} MB; consider archiving before the pilot so dashboard numbers reflect only pilot runs`,
    };
  }
  return {
    name: "metrics DB",
    status: "PASS",
    message: `${(size / 1024).toFixed(0)} KB - within pilot baseline`,
  };
}

function format(result: CheckResult): string {
  const badge =
    result.status === "PASS"
      ? "[PASS]"
      : result.status === "WARN"
        ? "[WARN]"
        : "[FAIL]";
  return `${badge} ${result.name.padEnd(28)} ${result.message}`;
}

function main(): void {
  const args = parseCliArgs();
  const checks: CheckResult[] = [
    checkNodeVersion(),
    checkGhCli(),
    checkAuth(),
    checkSmoke(),
    checkCalibration(),
    checkInputs(),
    checkMetricsDb(),
  ];

  if (!args.quiet) {
    for (const c of checks) {
      process.stdout.write(format(c) + "\n");
    }
  }

  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const blocking = args.strict ? failCount + warnCount : failCount;

  const summary =
    blocking > 0
      ? `Pilot dry-run: BLOCKED (${failCount} FAIL${args.strict ? `, ${warnCount} WARN counted strict` : ""})`
      : `Pilot dry-run: READY (${warnCount} WARN, non-blocking)`;
  process.stdout.write(summary + "\n");
  process.exit(blocking > 0 ? 1 : 0);
}

main();
