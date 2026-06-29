#!/usr/bin/env node
/**
 * derive-envelope.test.ts — regression coverage for the plan→envelope
 * parsers that feed the envelope-validation gate. Pinned behaviours:
 *   - `Selector quality score: 4.5/5` normalises to 0.9 (ratio, not raw)
 *   - locator columns keep source order (original=first, target=second)
 *   - confidence cells normalise and unknown values throw loudly
 *
 * Run:  npx tsx --test scripts/derive-envelope.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveEnvelope,
  inferFrameworkFromBasename,
  normaliseConfidence,
  parseExpectedMetrics,
  parseLocatorTable,
} from "./derive-envelope.js";

test("parseExpectedMetrics: 'Selector quality score: 4.5/5' normalises to 0.9", () => {
  const body = [
    "- Selector quality score: 4.5/5",
    "- Smell count delta: -6",
    "- LOC delta: -12",
    "- Anti-pattern coverage: 3/4",
  ].join("\n");
  const m = parseExpectedMetrics(body);
  assert.equal(m.selectorQualityScore, 0.9);
  assert.equal(m.smellCountDelta, -6);
  assert.equal(m.locDelta, -12);
  assert.equal(m.antiPatternCoverage, "3/4");
});

test("parseLocatorTable: a 2-column row keeps source order (not swapped)", () => {
  const body = [
    "| Original | New | Confidence | Notes |",
    "|---|---|---|---|",
    "| cy.get('#email') | page.getByLabel('Email') | high | role-based |",
  ].join("\n");
  const rows = parseLocatorTable(body);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.original, "cy.get('#email')");
  assert.equal(rows[0]?.target, "page.getByLabel('Email')");
  assert.equal(rows[0]?.confidence, "high");
});

test("normaliseConfidence: maps short + long forms to the canonical band", () => {
  assert.equal(normaliseConfidence("M"), "med");
  assert.equal(normaliseConfidence("High"), "high");
  assert.equal(normaliseConfidence("medium"), "med");
  assert.equal(normaliseConfidence("l"), "low");
});

test("normaliseConfidence: throws on an unknown value", () => {
  assert.throws(() => normaliseConfidence("maybe"), /Unknown confidence value/);
});

test("deriveEnvelope: composes framework + metrics from a minimal plan", () => {
  const md = [
    "## Source framework",
    "",
    "cypress",
    "",
    "## Expected metrics",
    "",
    "- Selector quality score: 4.5/5",
  ].join("\n");
  const env = deriveEnvelope(md, "login.cy.js.md");
  assert.equal(env.sourceFramework, "cypress");
  assert.equal(env.subtractive, false); // only bad-playwright is subtractive
  assert.equal(env.expectedMetrics.selectorQualityScore, 0.9);
});

// ---- envelope-gate hardening: framework inference from the input extension when
// the plan body doesn't name it (the unreproduced 2/10 plan-gate failure class).

test("inferFrameworkFromBasename: extension → framework", () => {
  assert.equal(inferFrameworkFromBasename("internet-select.cy.js"), "cypress");
  assert.equal(inferFrameworkFromBasename("internet-select.cy.ts"), "cypress");
  assert.equal(inferFrameworkFromBasename("HomePageTests.java"), "selenium-java");
  assert.equal(inferFrameworkFromBasename("test_login.py"), "selenium-python");
  assert.equal(inferFrameworkFromBasename("flaky-waits.spec.ts"), "bad-playwright");
  assert.equal(inferFrameworkFromBasename("legacy.js"), "bad-playwright");
  assert.equal(inferFrameworkFromBasename("README.md"), null);
});

test("deriveEnvelope: a plan body that never names the framework falls back to the input extension (no throw)", () => {
  // Minimal plan with NO framework keyword anywhere — previously threw + crashed
  // the whole derivation, failing the envelope gate opaquely.
  const md = [
    "## Summary",
    "",
    "### User-perceivable assertion checklist",
    "- [x] dashboard greeting is visible",
  ].join("\n");
  const env = deriveEnvelope(md, "internet-hovers.cy.js");
  assert.equal(env.sourceFramework, "cypress");
  assert.equal(env.subtractive, false); // only bad-playwright is subtractive
  assert.ok(env.scenarios.length >= 1);
});

test("deriveEnvelope: a Java input with no framework keyword infers selenium-java", () => {
  const env = deriveEnvelope("## Summary\n\nNothing names the framework here.", "EmployeesTest.java");
  assert.equal(env.sourceFramework, "selenium-java");
});
