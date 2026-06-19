#!/usr/bin/env node
/**
 * lean-profile.test.ts — regression guard for ADR 0002 Phase 1. Proves the
 * additive `--profile lean` relaxation: a spec importing test/expect from
 * `@playwright/test` is BLOCKED under the default qa-master profile but PASSES
 * the import-source check under `--profile lean`. Locks the behaviour so a
 * future edit can't silently re-block lean or, worse, relax qa-master.
 *
 * Run:  npx tsx --test scripts/lean-profile.test.ts
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const VALIDATOR = join(REPO_ROOT, "scripts", "validate-qa-master-conformance.ts");

const LEAN_SPEC = [
  'import { test, expect } from "@playwright/test";',
  "",
  'test("[ACME-1] - Check that the page loads", async ({ page }) => {',
  '  await test.step("open", async () => { await page.goto("/"); });',
  '  await expect(page).toHaveTitle(/Acme/);',
  "});",
  "",
].join("\n");

function runValidator(root: string, profile: "qa-master" | "lean"): string {
  const args = ["tsx", VALIDATOR, "--root", root];
  if (profile === "lean") args.push("--profile", "lean");
  const r = spawnSync("npx", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

test("lean profile relaxes the spec @playwright/test import-source rule (qa-master still blocks)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pwm-lean-"));
  try {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "lean-demo.spec.ts"), LEAN_SPEC);
    // Default qa-master: the @playwright/test spec import is blocked.
    assert.match(runValidator(dir, "qa-master"), /import-source/);
    // Lean: that specific rule no longer fires.
    assert.doesNotMatch(runValidator(dir, "lean"), /specs must import .* from `@fixtures\/base\.fixture`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
