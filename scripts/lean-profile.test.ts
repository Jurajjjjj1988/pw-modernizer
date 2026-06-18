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
    // Default qa-master: both the @playwright/test import AND page.goto are blocked.
    const def = runValidator(dir, "qa-master");
    assert.match(def, /import-source/);
    assert.match(def, /page-goto-in-spec/);
    // Lean: a minimal spec (raw page + @playwright/test import) is fully CLEAN.
    assert.match(runValidator(dir, "lean"), /clean\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lean accepts a realistic spec + page object (relative import) that qa-master blocks", () => {
  const dir = mkdtempSync(join(tmpdir(), "pwm-lean2-"));
  try {
    mkdirSync(join(dir, "tests"), { recursive: true });
    mkdirSync(join(dir, "helper", "page-object", "pages"), { recursive: true });
    writeFileSync(join(dir, "tests", "login.spec.ts"), [
      'import { test, expect } from "@playwright/test";',
      'import { LoginPage } from "../helper/page-object/pages/login.page";',
      "",
      'test("[ACME-1] - Check that valid credentials sign in", async ({ page }) => {',
      "  const login = new LoginPage(page);",
      '  await test.step("sign in", async () => { await login.signIn("u", "p"); });',
      '  await expect(page.getByRole("heading")).toBeVisible();',
      "});",
    ].join("\n"));
    writeFileSync(join(dir, "helper", "page-object", "pages", "login.page.ts"), [
      'import { type Page, type Locator } from "@playwright/test";',
      "",
      "export class LoginPage {",
      "  readonly email: Locator;",
      "  constructor(private readonly page: Page) { this.email = page.getByLabel(\"Email\"); }",
      "  async signIn(u: string, p: string): Promise<void> { await this.email.fill(u); }",
      "}",
    ].join("\n"));
    // Lean: a plain spec + page object via relative import is fully clean.
    assert.match(runValidator(dir, "lean"), /clean\./);
    // qa-master: blocked (the relative parent-dir import among others).
    assert.match(runValidator(dir, "qa-master"), /relative-imports/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
