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
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  checkAssertionFloor,
  collectEmittedSources,
  computeAggregateConfidence,
  countAssertions,
  countSmells,
  domProbeConfirmed,
  findForbidden,
  type Report,
  UNVERIFIED_LOCATOR_CONFIDENCE_CAP,
} from "./evaluate.js";

/** A high-quality report (all signals near-perfect) parameterised by grounding. */
function highQualityReport(domGrounded: boolean): Report {
  const emptySmell = {
    hardWaits: 0, magicNumbers: 0, forcedClicks: 0, nthSelectors: 0, cssClassSelectors: 0,
    pagePauses: 0, testOnly: 0, testSkip: 0, anyType: 0, consoleLog: 0,
    nonWebFirstAsserts: 0, conditionalInTest: 0, assertionRoulette: 0,
  };
  return {
    input: "x", output: "y",
    source: { ...emptySmell, hardWaits: 4 }, outputSmells: emptySmell,
    selector: { canonical: 10, fragile: 0 }, selectorQuality: 1, webFirstRate: 1,
    forbidden: [], trivial: false,
    confidence: { high: 5, med: 0, low: 0, aggregate: 1 },
    inputLoc: 20, outputLoc: 40,
    assertionFloor: { emitted: 5, floor: 1, passed: true },
    domGrounded,
  };
}

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const EVALUATE = join(REPO_ROOT, "scripts", "evaluate.ts");

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

// ---- 2A: findForbidden flags non-functional placeholder code.

test("findForbidden: flags a 'not implemented' throw that punts the assertion", () => {
  const src = [
    "test('[X-1] - submits the form', async ({ checkoutPage }) => {",
    "  await checkoutPage.submit();",
    "  throw new Error('not implemented');",
    "});",
  ].join("\n");
  assert.ok(
    findForbidden(src).some((f) => /placeholder/.test(f)),
    "a non-functional 'not implemented' throw must be a forbidden pattern",
  );
});

test("findForbidden: does NOT flag the word TODO inside a comment or string literal", () => {
  const src = [
    "// TODO: replaces the legacy waitForTimeout(7000) — see plan Q3",
    "const note = 'parses the TODO column header';",
    "await expect(page.getByText('FIXME label')).toBeVisible();",
  ].join("\n");
  assert.deepEqual(
    findForbidden(src),
    [],
    "comment TODO is stripped (owned by validate-todo-discipline); TODO/FIXME as string data are not placeholders",
  );
});

test("findForbidden: flags test.todo / it.fixme pending-test placeholders", () => {
  assert.ok(findForbidden("test.todo('add edge case');").some((f) => /placeholder/.test(f)));
  assert.ok(findForbidden("it.fixme('broken case', async () => {});").some((f) => /placeholder/.test(f)));
});

// ---- 1D: assertion floor.

test("checkAssertionFloor: zero emitted assertions fails the floor", () => {
  const r = checkAssertionFloor(0);
  assert.equal(r.passed, false);
  assert.equal(r.floor, 1);
});

test("checkAssertionFloor: at least one emitted assertion passes", () => {
  assert.equal(checkAssertionFloor(1).passed, true);
  assert.equal(checkAssertionFloor(7).passed, true);
});

test("countAssertions: counts POM assertions across the emitted tree, excludes comments", () => {
  // The load-bearing reuse: an assertion living in a POM (not the spec) must
  // count, and a commented-out `expect(` must not — else a no-op spec whose
  // only 'assertion' is in a doc-comment would pass the floor.
  const root = mkdtempSync(join(tmpdir(), "pwm-assert-"));
  try {
    const tests = join(root, "tests");
    const pages = join(root, "helper", "page-object", "pages");
    mkdirSync(tests, { recursive: true });
    mkdirSync(pages, { recursive: true });
    writeFileSync(join(tests, "checkout.spec.ts"),
      "import { test } from '@fixtures/base.fixture';\n// expect( was here in the legacy test\ntest('x', async ({ p }) => { await p.assertOnPage(); });\n");
    writeFileSync(join(pages, "checkout.page.ts"),
      "export class C { async assertOnPage() { await expect(this.page).toHaveURL(/x/); } }\n");
    const combined = collectEmittedSources(join(tests, "checkout.spec.ts"), join(root, "helper"));
    assert.equal(countAssertions(combined), 1, "POM assertion counts; commented expect( does not");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evaluate main(): a zero-assertion emitted tree is rejected with a non-zero exit", () => {
  // Integration: prove the gate actually fires end-to-end (evaluate.ts is now a
  // GATE, not just a scorer). Unique spec stem so no real outputs/helper file
  // matches and the emitted tree is exactly the zero-assertion spec.
  const root = mkdtempSync(join(tmpdir(), "pwm-gate-"));
  try {
    const input = join(root, "old.spec.ts");
    const spec = join(root, "zero-assertion-fixture.spec.ts");
    const plan = join(root, "plan.md");
    const reportOut = join(root, "report.md");
    writeFileSync(input, "test('old', async () => { await page.waitForTimeout(500); expect(x).toBe(1); });\n");
    // Emitted spec asserts NOTHING — the silent no-op the gate must catch.
    writeFileSync(spec, "import { test } from '@fixtures/base.fixture';\ntest('[X-1] - loads', async ({ p }) => { await p.open(); });\n");
    writeFileSync(plan, "## Source framework\nbad-playwright\n\n| locator | confidence |\n|---|---|\n| getByRole | HIGH |\n");
    const r = spawnSync("npx", ["tsx", EVALUATE,
      "--input", input, "--output", spec, "--plan", plan, "--report-out", reportOut,
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.notEqual(r.status, 0, "zero-assertion emitted tree must exit non-zero");
    assert.match(`${r.stderr ?? ""}`, /assert/i, "stderr must explain the assertion-floor rejection");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- 2B: assertion roulette (low-recall v0 proxy: > 4 awaited expects in one body).

test("countSmells: flags a test body with > 4 awaited expects as assertion roulette", () => {
  const body = (n: number) => [
    "test('[X-1] - roulette', async ({ page }) => {",
    ...Array.from({ length: n }, (_, i) => `  await expect(page.getByTestId('f${i}')).toBeVisible();`),
    "});",
  ].join("\n");
  assert.equal(countSmells(body(6)).assertionRoulette, 1, "6 awaited expects in one body is roulette");
});

test("countSmells: a coherent 4-assert form-save check is NOT flagged as roulette", () => {
  // The deliberate false-positive guard — threshold is > 4 so the common
  // 4-field check stays clean.
  const src = [
    "test('[X-2] - save profile', async ({ page }) => {",
    "  await expect(page.getByLabel('First')).toHaveValue('Ann');",
    "  await expect(page.getByLabel('Last')).toHaveValue('Lee');",
    "  await expect(page.getByLabel('Email')).toHaveValue('a@b.c');",
    "  await expect(page.getByRole('status')).toHaveText('Saved');",
    "});",
  ].join("\n");
  assert.equal(countSmells(src).assertionRoulette, 0, "4 awaited expects is a coherent check, not roulette");
});

test("countSmells: documented v0 limitation — expects after a test.step boundary are under-counted", () => {
  // The non-greedy test-body regex ends at the FIRST `\n})`, which here is the
  // inner test.step's closer — so the 4 awaited expects that follow it (still in
  // the real test body) fall outside the captured span and are not counted. Five
  // real assertions read as one; the body is NOT flagged. Locked in as known v0
  // behavior, not a silent surprise (the ts-morph v1 upgrade closes this).
  const src = [
    "test('[X-3] - stepped', async ({ page }) => {",
    "  await test.step('open', async () => {",
    "    await expect(page.getByTestId('f0')).toBeVisible();",
    "  });",
    "  await expect(page.getByTestId('f1')).toBeVisible();",
    "  await expect(page.getByTestId('f2')).toBeVisible();",
    "  await expect(page.getByTestId('f3')).toBeVisible();",
    "  await expect(page.getByTestId('f4')).toBeVisible();",
    "});",
  ].join("\n");
  assert.equal(countSmells(src).assertionRoulette, 0, "v0 regex under-counts across the test.step boundary (documented)");
});

// ---- Grounding cap: unverified canonical locators must not auto-ship.

test("computeAggregateConfidence: an ungrounded high-quality migration is capped below the verify gate", () => {
  const capped = computeAggregateConfidence(highQualityReport(false));
  assert.ok(capped <= UNVERIFIED_LOCATOR_CONFIDENCE_CAP, `expected <= ${UNVERIFIED_LOCATOR_CONFIDENCE_CAP}, got ${capped}`);
  assert.ok(capped < 0.7, "ungrounded must route to verify (< 0.7), not auto-ship");
});

test("computeAggregateConfidence: the SAME migration with a passing DOM probe is NOT capped", () => {
  const grounded = computeAggregateConfidence(highQualityReport(true));
  assert.ok(grounded > UNVERIFIED_LOCATOR_CONFIDENCE_CAP, "grounded keeps full score and may auto-ship");
  // The cap is the ONLY difference between the two — proves it is grounding-driven.
  assert.ok(grounded - computeAggregateConfidence(highQualityReport(false)) > 0.2);
});

test("domProbeConfirmed: true only when a probe resolved real locators with zero not-found", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-probe-"));
  try {
    const reportOut = join(root, "demo.spec.ts.md");
    const probe = join(root, "demo.spec.ts-dom-probe.json");
    assert.equal(domProbeConfirmed(reportOut), false, "no probe file → not grounded");
    writeFileSync(probe, JSON.stringify({ totalLocators: 6, resolvedUnique: 6, notFound: 0 }));
    assert.equal(domProbeConfirmed(reportOut), true, "all resolved, none missing → grounded");
    writeFileSync(probe, JSON.stringify({ totalLocators: 6, resolvedUnique: 4, notFound: 2 }));
    assert.equal(domProbeConfirmed(reportOut), false, "a not-found (hallucinated) locator → NOT grounded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
