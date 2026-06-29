/**
 * claude-cli.ts — run the claude-code CLI with a HARD timeout + retry (reliability).
 *
 * Every Stage-1 (plan), Stage-2 (generate), repair, and judge step shells out to
 * `npx @anthropic-ai/claude-code …` via spawnSync WITHOUT a timeout. When that CLI
 * call hangs (a real, observed failure mode — the model/API stalls and the process
 * never exits), the ENTIRE pipeline hangs forever: no progress, no error, nothing
 * to retry. A pipeline that can hang indefinitely is not production-ready.
 *
 * This wraps the spawn with a bounded timeout (the child is killed if it exceeds
 * it) and a single retry on timeout (the stall is usually transient), so a hung
 * call fails CLEANLY instead of hanging. Tunable:
 *   CLAUDE_CLI_TIMEOUT_MS  per-call ceiling (default 600000 = 10 min; a legit
 *                          50-turn generate runs ~8 min, so this is generous).
 *   CLAUDE_CLI_RETRIES     extra attempts on timeout (default 1).
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const TIMEOUT_MS = Math.max(2_000, Number(process.env["CLAUDE_CLI_TIMEOUT_MS"]) || 600_000);
const MAX_ATTEMPTS = Math.max(1, (Number(process.env["CLAUDE_CLI_RETRIES"]) || 1) + 1);

export interface ClaudeCliResult {
  /** status === 0 (the CLI succeeded). */
  ok: boolean;
  /** The process exit status (null when killed by the timeout). */
  status: number | null;
  /** True when every attempt exceeded the timeout (the hang case). */
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** True when spawnSync killed the child for exceeding `timeout`. On a timeout Node
 * sets `result.error` to an Error with code 'ETIMEDOUT' (the reliable signal) and
 * a null status; a process killed by the signal alone has a null status + a signal. */
export function wasTimeout(r: Pick<SpawnSyncReturns<string>, "error" | "status" | "signal">): boolean {
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ETIMEDOUT") return true;
  return r.status === null && r.signal !== null;
}

/** Human-readable timeout (e.g. "10 min" / "3s"). */
function humanMs(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)}s`;
}

/**
 * Run `npx @anthropic-ai/claude-code <claudeArgs>` with a hard timeout + retry on
 * timeout. By default stdout/stderr are inherited (streamed live); pass
 * `capture: true` to collect stdout instead (e.g. the judge parses it).
 */
export function runClaudeCli(claudeArgs: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; capture?: boolean }): ClaudeCliResult {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = spawnSync("npx", ["--yes", "@anthropic-ai/claude-code", ...claudeArgs], {
      cwd: opts.cwd,
      env: opts.env,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      killSignal: "SIGTERM",
      ...(opts.capture ? {} : { stdio: ["ignore", "inherit", "inherit"] as ["ignore", "inherit", "inherit"] }),
    });
    if (!wasTimeout(r)) {
      return { ok: r.status === 0, status: r.status, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    }
    process.stderr.write(`\n  ⚠ claude-code CLI exceeded ${humanMs(TIMEOUT_MS)} (a hung call) — attempt ${attempt}/${MAX_ATTEMPTS}\n`);
  }
  return { ok: false, status: null, timedOut: true, stdout: "", stderr: `claude-code CLI timed out after ${MAX_ATTEMPTS} attempt(s)` };
}
