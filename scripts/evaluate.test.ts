#!/usr/bin/env node
/**
 * evaluate.test.ts — regression coverage for countSmells, the comment-stripping
 * smell detector that feeds the aggregate confidence score. The subtle part is
 * that it strips comments FIRST so a doc-comment referencing the original smell
 * ("replaces waitForTimeout(7000)") doesn't count as a re-introduced smell — a
 * silent bug there would systematically depress confidence.
 *
 * Run:  npx tsx --test scripts/evaluate.test.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectEmittedSources, countSmells } from "./evaluate.js";

test("countSmells: comments referencing the original smell are stripped, not counted", () => {
  const src = [
    "// replaces waitForTimeout(7000) from the legacy test",
    "/* old: cy.wait(1000) */",
    "await expect(page.getByRole('alert')).toBeVisible();",
  ].join("\n");
  const c = countSmells(src);
  assert.equal(c.hardWaits, 0, "commented-out waits must not count");
});

test("countSmells: real hard waits are counted across frameworks", () => {
  const src = [
    "await page.waitForTimeout(500);",
    "cy.wait(1000);",
    "Thread.sleep(2000);",
    "time.sleep(3);",
  ].join("\n");
  assert.equal(countSmells(src).hardWaits, 4);
});

test("countSmells: nth/eq index selectors counted, magic numbers counted", () => {
  const src = [
    "await page.getByRole('row').nth(2).click();",
    "cy.get('li').eq(3);",
    "await page.goto('/products?page=12345');",
  ].join("\n");
  const c = countSmells(src);
  assert.equal(c.nthSelectors, 2);
  assert.ok(c.magicNumbers >= 1, "12345 should count as a magic number");
});

test("countSmells: a clean web-first spec has zero hard waits / nth / forced clicks", () => {
  const src = [
    "import { test, expect } from '@fixtures/base.fixture';",
    "test('[X-1] - Check that it loads', async ({ homePage }) => {",
    "  await homePage.open();",
    "  await expect(homePage.heading).toBeVisible();",
    "});",
  ].join("\n");
  const c = countSmells(src);
  assert.equal(c.hardWaits, 0);
  assert.equal(c.nthSelectors, 0);
  assert.equal(c.forcedClicks, 0);
});

test("collectEmittedSources: scores the migration's POM (stem-matched), not just the bare spec", () => {
  // qa-master hides locators in POMs; a scorer reading only the spec is blind.
  const root = mkdtempSync(join(tmpdir(), "pwm-emit-"));
  try {
    const tests = join(root, "tests");
    const pages = join(root, "helper", "page-object", "pages");
    mkdirSync(tests, { recursive: true });
    mkdirSync(pages, { recursive: true });
    // Spec imports test/expect from the fixture barrel (no locators in the spec).
    writeFileSync(join(tests, "search-filters.spec.ts"),
      "import { test, expect } from '@fixtures/base.fixture';\ntest('x', async ({ p }) => { await expect(p.results).toBeVisible(); });\n");
    // The migration's own POM ships a fragile CSS-class locator.
    writeFileSync(join(pages, "search-filters.page.ts"),
      "export class SF { readonly results = this.page.locator('.product-card'); }\n");
    // An UNRELATED migration's POM must NOT leak into this score.
    writeFileSync(join(pages, "other.page.ts"),
      "export class O { readonly x = this.page.locator('.unrelated'); }\n");

    const combined = collectEmittedSources(join(tests, "search-filters.spec.ts"), join(root, "helper"));
    assert.ok(combined.includes(".product-card"), "must include the migration's own POM");
    assert.ok(!combined.includes(".unrelated"), "must NOT include an unrelated migration's POM");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
