#!/usr/bin/env node
/**
 * migrate-local.test.ts — regression coverage for the local Stage-2 CLI's
 * parity-critical pure logic: path derivation (must match migrate.yml's BASE/
 * PLAN/ENVELOPE/REPORT) and the spec-basename scoping that picks THIS run's
 * generated spec.
 *
 * Run:  npx tsx --test scripts/migrate-local.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { derivePaths, expectedSpecBasenames } from "./migrate-local.js";

test("derivePaths: BASE/plan/envelope/report mirror migrate.yml (BASE = basename(input))", () => {
  const p = derivePaths({ input: "inputs/bad-playwright/foo.spec.ts", plan: "", mock: false, help: false, check: false, profile: "qa-master" });
  assert.equal(p.base, "foo.spec.ts");
  assert.ok(p.plan.endsWith("outputs/plans/foo.spec.ts.md"), p.plan);
  assert.ok(p.envelope.endsWith("outputs/plans/foo.spec.ts.envelope.json"), p.envelope);
  assert.ok(p.report.endsWith("outputs/reports/foo.spec.ts.md"), p.report);
});

test("derivePaths: explicit --plan overrides the default plan path", () => {
  const p = derivePaths({ input: "inputs/cypress/bar.cy.js", plan: "custom/plan.md", mock: false, help: false, check: false, profile: "qa-master" });
  assert.equal(p.base, "bar.cy.js");
  assert.ok(p.plan.endsWith("custom/plan.md"), p.plan);
  // envelope/report still derive from BASE, not from the override
  assert.ok(p.envelope.endsWith("outputs/plans/bar.cy.js.envelope.json"), p.envelope);
});

test("expectedSpecBasenames: camelCase Java → kebab + dropped -test", () => {
  const out = expectedSpecBasenames("AddCookiesJupiterTest.java");
  assert.ok(out.includes("add-cookies-jupiter-test.spec.ts"));
  assert.ok(out.includes("add-cookies-jupiter.spec.ts")); // trailing -test dropped
});

test("expectedSpecBasenames: pytest test_ prefix → both with and without leading test-", () => {
  const out = expectedSpecBasenames("test_employees.py");
  assert.ok(out.includes("test-employees.spec.ts"));
  assert.ok(out.includes("employees.spec.ts")); // leading test- dropped (pytest → playwright)
});

test("expectedSpecBasenames: cypress snake/kebab → kebab spec", () => {
  assert.ok(expectedSpecBasenames("checkout_flow.cy.js").includes("checkout-flow.spec.ts"));
  assert.ok(expectedSpecBasenames("wishlist.cy.js").includes("wishlist.spec.ts"));
});
