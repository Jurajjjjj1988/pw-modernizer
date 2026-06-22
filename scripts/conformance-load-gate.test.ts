#!/usr/bin/env node
/**
 * conformance-load-gate.test.ts — W15 regression: a shared page's
 * waitForPageLoad() must gate on a STRUCTURAL invariant (toHaveURL or a
 * navigation/main/banner landmark), not on scenario-specific page CONTENT.
 *
 * A content gate (e.g. a welcome heading) is the cross-migration POM
 * contamination from the measured Run 2 (docs/quality-research-findings.md):
 * every migration reusing the page inherits one scenario's data dependency.
 *
 * Run:  npx tsx --test scripts/conformance-load-gate.test.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const VALIDATOR = join(REPO_ROOT, "scripts", "validate-qa-master-conformance.ts");

/** Write a one-page qa-master tree and run the conformance validator over it. */
function runOverPage(pageSrc: string): string {
  const root = mkdtempSync(join(tmpdir(), "pwm-w15-"));
  try {
    const pages = join(root, "helper", "page-object", "pages");
    mkdirSync(pages, { recursive: true });
    writeFileSync(join(pages, "dash.page.ts"), pageSrc);
    const r = spawnSync("npx", ["tsx", VALIDATOR, "--root", root], { cwd: REPO_ROOT, encoding: "utf8" });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const CONTENT_GATE = [
  'import { expect, type Locator } from "@playwright/test";',
  'import { BasePage } from "@page-object/basepage";',
  "export class PageClassDash extends BasePage {",
  "  readonly headingWelcome: Locator = this.page.getByRole('heading', { name: /welcome back/i }).describe('[Dash] Welcome heading');",
  "  async waitForPageLoad(): Promise<void> {",
  "    await expect(this.headingWelcome, '[Dash] welcome visible').toBeVisible();",
  "  }",
  "}",
  "",
].join("\n");

const URL_GATE = [
  'import { expect } from "@playwright/test";',
  'import { BasePage } from "@page-object/basepage";',
  "export class PageClassDash extends BasePage {",
  "  async waitForPageLoad(): Promise<void> {",
  "    await expect(this.page, '[Dash] dashboard URL').toHaveURL(/\\/dashboard/);",
  "  }",
  "}",
  "",
].join("\n");

const LANDMARK_GATE = [
  'import { expect, type Locator } from "@playwright/test";',
  'import { BasePage } from "@page-object/basepage";',
  "export class PageClassDash extends BasePage {",
  "  readonly mainRegion: Locator = this.page.getByRole('main').describe('[Dash] Main region');",
  "  async waitForPageLoad(): Promise<void> {",
  "    await expect(this.mainRegion, '[Dash] main landmark visible').toBeVisible();",
  "  }",
  "}",
  "",
].join("\n");

test("W15: a content-gated waitForPageLoad (welcome heading) is flagged", () => {
  assert.match(runOverPage(CONTENT_GATE), /gates on scenario CONTENT/, "content gate must fire W15");
});

test("W15: a URL-gated waitForPageLoad (toHaveURL) is NOT flagged", () => {
  assert.ok(!/gates on scenario CONTENT/.test(runOverPage(URL_GATE)), "toHaveURL is a structural invariant — must pass");
});

test("W15: a structural-landmark gate (getByRole('main')) is NOT flagged", () => {
  assert.ok(!/gates on scenario CONTENT/.test(runOverPage(LANDMARK_GATE)), "a main/navigation/banner landmark is structural — must pass");
});

const CONTROL_GATE = [
  'import { expect, type Locator } from "@playwright/test";',
  'import { BasePage } from "@page-object/basepage";',
  "export class PageClassDash extends BasePage {",
  "  readonly inputEmail: Locator = this.page.getByLabel('Email').describe('[Dash] Email input');",
  "  async waitForPageLoad(): Promise<void> {",
  "    await expect(this.inputEmail, '[Dash] email field visible').toBeVisible();",
  "  }",
  "}",
  "",
].join("\n");

test("W15: a stable control gate (input field visibility) is NOT flagged — only scenario content is", () => {
  assert.ok(!/gates on scenario CONTENT/.test(runOverPage(CONTROL_GATE)), "a form-control visibility gate is migration-independent — must pass");
});
