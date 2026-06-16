#!/usr/bin/env node
/**
 * capture-failure.test.ts — regression coverage for the triage anomaly
 * detectors. Both cases here are bugs found by dogfooding the tool on real PRs:
 *   - filename-drift false positive on camelCase Java vs kebab TS (PR #151)
 *   - silently-dropped conflicting verify/confidence labels (PR #13)
 *
 * Run:  npx tsx --test scripts/capture-failure.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectAnomalies,
  filenameDrift,
  labelConflicts,
  scanReport,
  verdictFromLabels,
} from "./capture-failure.js";

const kinds = (as: { kind: string }[]): string[] => as.map((a) => a.kind);

test("filenameDrift: camelCase Java vs kebab TS is NOT drift (PR #151 regression)", () => {
  assert.deepEqual(
    filenameDrift("inputs/selenium-java/AddCookiesJupiterTest.java", "outputs/tests/add-cookies-jupiter-test.spec.ts"),
    [],
  );
});

test("filenameDrift: dropped suffix still counts as related", () => {
  assert.deepEqual(
    filenameDrift("inputs/selenium-java/AddCookiesJupiterTest.java", "outputs/tests/add-cookies.spec.ts"),
    [],
  );
});

test("filenameDrift: genuinely different feature names ARE drift", () => {
  const a = filenameDrift("inputs/cypress/wishlist.cy.js", "outputs/tests/search-filters.spec.ts");
  assert.equal(a.length, 1);
  assert.equal(a[0]?.kind, "filename-drift");
});

test("filenameDrift: missing either side yields nothing", () => {
  assert.deepEqual(filenameDrift(null, "outputs/tests/x.spec.ts"), []);
  assert.deepEqual(filenameDrift("inputs/cypress/x.cy.js", null), []);
});

test("verdictFromLabels: single verdict reads cleanly", () => {
  assert.equal(verdictFromLabels(["migrator:code", "verify:ship-it"]), "SHIP IT");
});

test("verdictFromLabels: no verdict label is UNKNOWN", () => {
  assert.equal(verdictFromLabels(["migrator:code"]), "UNKNOWN");
});

test("verdictFromLabels: stacked verdicts surface as CONFLICT (PR #13 regression)", () => {
  const v = verdictFromLabels(["verify:start-over", "verify:fix-first"]);
  assert.match(v, /^CONFLICT\(/);
  assert.match(v, /start-over/);
  assert.match(v, /fix-first/);
});

test("labelConflicts: stacked verify + confidence labels are flagged", () => {
  const a = labelConflicts(["verify:start-over", "verify:fix-first", "confidence:low", "confidence:high"]);
  assert.deepEqual(kinds(a).sort(), ["conflicting-confidence-labels", "conflicting-verdict-labels"]);
});

test("labelConflicts: a clean label set yields nothing", () => {
  assert.deepEqual(labelConflicts(["migrator:code", "verify:ship-it", "confidence:high"]), []);
});

test("scanReport: low plan confidence + residual smell are detected", () => {
  const report = [
    "## Quality scores",
    "- Plan confidence: 1 high / 5 med / 6 low → avg 0.43",
    "## Smell count",
    "| hardWaits | 6 | 0 |",
    "| magicNumbers | 8 | 2 |",
  ].join("\n");
  assert.deepEqual(kinds(scanReport(report)).sort(), ["low-plan-confidence", "residual-smell"]);
});

test("scanReport: a healthy report yields no anomalies", () => {
  const report = [
    "- Plan confidence: 8 high / 2 med / 0 low → avg 0.85",
    "| hardWaits | 6 | 0 |",
    "## Forbidden patterns in output",
    "✅ None.",
  ].join("\n");
  assert.deepEqual(scanReport(report), []);
});

test("detectAnomalies: composes drift + report scan", () => {
  const report = "- Plan confidence: avg 0.40";
  const a = detectAnomalies(report, "inputs/cypress/wishlist.cy.js", "outputs/tests/search-filters.spec.ts");
  assert.ok(kinds(a).includes("filename-drift"));
  assert.ok(kinds(a).includes("low-plan-confidence"));
});
