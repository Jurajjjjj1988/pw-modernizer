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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  derivePaths,
  estimateInputCostUsd,
  estimateTokensFromChars,
  expandInputs,
  expectedSpecBasenames,
  type Args,
} from "./migrate-local.js";

const baseArgs: Args = { input: "", inputs: "", plan: "", mock: false, help: false, check: false, profile: "qa-master" };

test("derivePaths: BASE/plan/envelope/report mirror migrate.yml (BASE = basename(input))", () => {
  const p = derivePaths({ ...baseArgs, input: "inputs/bad-playwright/foo.spec.ts" });
  assert.equal(p.base, "foo.spec.ts");
  assert.ok(p.plan.endsWith("outputs/plans/foo.spec.ts.md"), p.plan);
  assert.ok(p.envelope.endsWith("outputs/plans/foo.spec.ts.envelope.json"), p.envelope);
  assert.ok(p.report.endsWith("outputs/reports/foo.spec.ts.md"), p.report);
});

test("derivePaths: explicit --plan overrides the default plan path", () => {
  const p = derivePaths({ ...baseArgs, input: "inputs/cypress/bar.cy.js", plan: "custom/plan.md" });
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

// ---- 2E: cost estimator (pure; hand-computed expectations catch a wiring flip).

test("estimateTokensFromChars: ~4 chars/token, rounds up", () => {
  assert.equal(estimateTokensFromChars(8), 2);
  assert.equal(estimateTokensFromChars(9), 3); // Math.ceil(9/4)
  assert.equal(estimateTokensFromChars(0), 0);
});

test("estimateInputCostUsd: 1M tokens = $3 at Sonnet input rate; per-million divisor", () => {
  const big = estimateInputCostUsd(4_000_000); // 1,000,000 tokens
  assert.equal(big.tokens, 1_000_000);
  assert.equal(big.usd, 3); // 1M × $3/M — flipping the divisor or rate fails this
  const small = estimateInputCostUsd(40_000); // 10,000 tokens
  assert.ok(Math.abs(small.usd - 0.03) < 1e-9, `expected ~0.03, got ${small.usd}`);
});

// ---- 3A: glob expansion (the `*` vs `**` distinction is the load-bearing bug).

test("expandInputs: single `*` stays within one dir; `**` spans directories", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-glob-"));
  try {
    // tree: inputs/top.cy.js, inputs/a/x.cy.js, inputs/b/y.cy.js, inputs/a/deep/z.cy.js
    for (const rel of ["inputs/top.cy.js", "inputs/a/x.cy.js", "inputs/b/y.cy.js", "inputs/a/deep/z.cy.js"]) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "// fixture\n");
    }
    const rel = (paths: string[]): string[] => paths.map((p) => p.slice(root.length + 1).replaceAll("\\", "/")).sort();

    // `inputs/*/*.cy.js` — exactly one dir deep: a/x and b/y, NOT top (0 deep), NOT a/deep/z (2 deep).
    assert.deepEqual(rel(expandInputs("inputs/*/*.cy.js", root)), ["inputs/a/x.cy.js", "inputs/b/y.cy.js"]);
    // `inputs/**/*.cy.js` — any depth: all four.
    assert.deepEqual(
      rel(expandInputs("inputs/**/*.cy.js", root)),
      ["inputs/a/deep/z.cy.js", "inputs/a/x.cy.js", "inputs/b/y.cy.js", "inputs/top.cy.js"],
    );
    // a glob matching nothing → empty.
    assert.deepEqual(expandInputs("inputs/*/nope.ts", root), []);
    // results are de-duplicated + lexically sorted (deepEqual above already pins order).
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expandInputs: real bad-playwright specs resolve and sort", () => {
  const found = expandInputs("inputs/bad-playwright/*.spec.ts").map((p) => p.split("/").pop());
  assert.ok(found.includes("force-clicks.spec.ts"), found.join(","));
  assert.deepEqual([...found].sort(), found, "results must be lexically sorted");
});
