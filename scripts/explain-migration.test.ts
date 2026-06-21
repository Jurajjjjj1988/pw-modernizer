#!/usr/bin/env node
/**
 * explain-migration.test.ts — coverage for the read-only migration explainer.
 *
 * The load-bearing case is INPUT-keyed resolution: a kebab-renamed spec
 * (add-cookies-jupiter-test.spec.ts) whose plan/envelope/report are keyed to the
 * ORIGINAL input basename (AddCookiesJupiterTest.java). basename(spec) would
 * resolve nothing — the base must come from the spec's `See outputs/plans/<base>`
 * header. A second case proves it distinguishes a degraded migration (a +delta
 * smell surfaces as a regression, while real +0 rows do not).
 *
 * Run:  npx tsx --test scripts/explain-migration.test.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { buildExplanation, parseSpecHeader, type ExplainInputs } from "./explain-migration.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const EXPLAIN = join(REPO_ROOT, "scripts", "explain-migration.ts");

test("parseSpecHeader: a kebab-renamed spec recovers the INPUT-keyed base, not its own name", () => {
  const src = [
    "// Migrated by PWmodernizer from inputs/selenium-java/AddCookiesJupiterTest.java.",
    "// See outputs/plans/AddCookiesJupiterTest.java.md for plan.",
    "import { test } from '@fixtures/base.fixture';",
  ].join("\n");
  const { base, inputPath } = parseSpecHeader(src);
  assert.equal(base, "AddCookiesJupiterTest.java", "base must come from the header, not the kebab spec filename");
  assert.equal(inputPath, "inputs/selenium-java/AddCookiesJupiterTest.java");
});

const fullInputs = (): ExplainInputs => ({
  specPath: "outputs/tests/add-cookies-jupiter-test.spec.ts",
  specSrc: "// from inputs/selenium-java/AddCookiesJupiterTest.java\n// See outputs/plans/AddCookiesJupiterTest.java.md\n",
  planMd: "| H | 8 | KB-1.3.1 | hard-wait | `Thread.sleep(2000)` | web-first wait |\n",
  envelopeRaw: JSON.stringify({
    sourceFramework: "selenium-java",
    scenarios: [{ id: "1.1", title: "adds a cookie and asserts it" }],
    requiredPages: ["outputs/helper/page-object/pages/cookies.page.ts"],
    requiredFixtures: ["outputs/helper/fixtures/base.fixture.ts"],
    locatorTable: [{ original: "By.id('x')", target: "getByTestId('x')", confidence: "low" }],
    hallucinationDefensePins: [{ pinId: 1 }],
  }),
  reportMd: "- **Aggregate confidence:** 0.74\n\n| hardWaits | 1 | 0 | -1 |\n| magicNumbers | 0 | 0 | +0 |\n",
});

test("buildExplanation: joins verdict, KB anti-patterns, emitted files, and confidence", () => {
  const e = buildExplanation(fullInputs());
  assert.equal(e.base, "AddCookiesJupiterTest.java");
  assert.equal(e.framework, "selenium-java");
  assert.equal(e.verdict, "SHIP IT"); // 0.74 ≥ 0.7 via verdictFromReportBody fallback
  assert.equal(e.confidence, 0.74);
  assert.ok(e.kbAntiPatterns.some((k) => k.id === "KB-1.3.1" && k.name === "hard-wait"));
  assert.ok(e.emittedFiles.includes("outputs/helper/page-object/pages/cookies.page.ts"));
  assert.equal(e.lowConfidenceLocators, 1);
  assert.equal(e.defensePins, 1);
  assert.equal(e.regressions.length, 0, "all deltas <= 0 → no regression");
});

test("buildExplanation: a +delta smell surfaces as a regression; +0 rows do not", () => {
  const inp = fullInputs();
  // Output ADDED 3 hard waits — a degraded migration the explainer must flag.
  inp.reportMd = "- **Aggregate confidence:** 0.55\n\n| hardWaits | 0 | 3 | +3 |\n| nthSelectors | 0 | 0 | +0 |\n";
  const e = buildExplanation(inp);
  assert.equal(e.regressions.length, 1, "+3 is a regression; +0 is not");
  assert.equal(e.regressions[0]?.smell, "hardWaits");
  assert.equal(e.regressions[0]?.delta, 3);
});

test("buildExplanation: missing artifacts degrade gracefully, no throw", () => {
  const e = buildExplanation({
    specPath: "outputs/tests/x.spec.ts",
    specSrc: "// See outputs/plans/x.spec.ts.md\n",
    planMd: null,
    envelopeRaw: null,
    reportMd: null,
  });
  assert.deepEqual(e.missingArtifacts, ["plan", "envelope", "report"]);
  assert.equal(e.verdict, "unknown");
  assert.equal(e.confidence, null);
  assert.equal(e.emittedFiles.length, 0);
});

test("end-to-end: resolves a kebab-renamed spec to its input-keyed artifacts (--root isolated)", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-explain-"));
  try {
    mkdirSync(join(root, "outputs/tests"), { recursive: true });
    mkdirSync(join(root, "outputs/plans"), { recursive: true });
    mkdirSync(join(root, "outputs/reports"), { recursive: true });
    writeFileSync(join(root, "outputs/tests/add-cookies-jupiter-test.spec.ts"),
      "// from inputs/selenium-java/AddCookiesJupiterTest.java\n// See outputs/plans/AddCookiesJupiterTest.java.md\n");
    writeFileSync(join(root, "outputs/plans/AddCookiesJupiterTest.java.md"),
      "| H | 8 | KB-1.3.1 | hard-wait | x | y |\n");
    writeFileSync(join(root, "outputs/plans/AddCookiesJupiterTest.java.envelope.json"),
      JSON.stringify({ sourceFramework: "selenium-java", scenarios: [], requiredPages: ["p.ts"], locatorTable: [], hallucinationDefensePins: [] }));
    writeFileSync(join(root, "outputs/reports/AddCookiesJupiterTest.java.md"),
      "- **Aggregate confidence:** 0.80\n\n| hardWaits | 1 | 0 | -1 |\n");
    const r = spawnSync("npx", [
      "tsx", EXPLAIN, "--root", root, "--spec", "outputs/tests/add-cookies-jupiter-test.spec.ts", "--json",
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const e = JSON.parse(r.stdout);
    assert.equal(e.base, "AddCookiesJupiterTest.java");
    assert.equal(e.framework, "selenium-java", "resolved the input-keyed envelope, not a missing kebab one");
    assert.equal(e.verdict, "SHIP IT");
    assert.deepEqual(e.missingArtifacts, [], "all three artifacts resolved despite the kebab rename");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
