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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  assembledPromptPath,
  buildPrompt,
  derivePaths,
  estimateInputCostUsd,
  estimateTokensFromChars,
  expandInputs,
  expectedSpecBasenames,
  type Args,
} from "./migrate-local.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const baseArgs: Args = { input: "", inputs: "", plan: "", mock: false, help: false, check: false, profile: "qa-master", repair: false };

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
  assert.deepEqual([...found].sort((a, b) => (a ?? "").localeCompare(b ?? "")), found, "results must be lexically sorted");
});

// ---- 3B: profile-aware Stage-2 wrapper prompt + assembled selection.

const demoPaths = derivePaths({ ...baseArgs, input: "inputs/cypress/demo.cy.js" });

test("buildPrompt qa-master: keeps the qa-master triad/STOP block + style anchor (unchanged)", () => {
  const prompt = buildPrompt(demoPaths, "qa-master");
  assert.match(prompt, /generate\.md/);
  assert.match(prompt, /FULL qa-master triad/);
  assert.match(prompt, /HARD-REJECTED/);
  assert.match(prompt, /examples\/reference\/qa-master\/ — style anchor/);
});

test("buildPrompt lean: points at generate.lean.md, relaxes the contract, drops the STOP block", () => {
  const prompt = buildPrompt(demoPaths, "lean");
  assert.match(prompt, /generate\.lean\.md/);
  assert.match(prompt, /MAY import test\/expect from @playwright\/test/);
  assert.ok(!/FULL qa-master triad/.test(prompt), "lean must NOT carry the qa-master STOP block");
  assert.ok(!/HARD-REJECTED/.test(prompt), "lean must NOT threaten the @playwright/test hard-reject");
  assert.ok(!/style anchor/.test(prompt), "lean does not load the qa-master style anchor");
});

test("assembledPromptPath: lean resolves generate.lean.md, qa-master resolves generate.md", () => {
  assert.ok(assembledPromptPath("lean").endsWith("prompts/_assembled/generate.lean.md"));
  assert.ok(assembledPromptPath("qa-master").endsWith("prompts/_assembled/generate.md"));
});

test("assembled generate.lean.md: keeps quality fragments, drops qa-master layering directives (catches a copy-from-qa-master regression)", () => {
  const lean = readFileSync(join(REPO_ROOT, "prompts/_assembled/generate.lean.md"), "utf8");
  // Quality fragments survived the composition (the bar on the CODE is unchanged).
  assert.match(lean, /force: true/, "forbidden-patterns fragment body present");
  assert.match(lean, /getByRole/, "locator-priority fragment body present");
  assert.match(lean, /LEAN profile|lean profile|spec \+ page object/i, "states the lean contract");
  // qa-master-only DIRECTIVES must NOT leak in — if someone regenerates this from
  // a copy of generate.md these positive-directive sentinels reappear and fail.
  assert.ok(!lean.includes("qa-master multi-file layout"), "no qa-master files-to-produce heading");
  assert.ok(!lean.includes("Always produce"), "no qa-master 'Always produce' layer directive");
  assert.ok(!lean.includes("Imports policy — STRICT"), "no qa-master strict two-scope import policy");
});

// ---- DOM grounding: closed-vocabulary snapshot injection into the Stage-2 prompt.

test("buildPrompt: injects the closed-vocabulary DOM snapshot when a snapshot path is given", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-grnd-"));
  try {
    const snap = join(root, "snap.yaml");
    writeFileSync(snap, '- textbox "Username"\n- button "Login"\n');
    const p = derivePaths({ ...baseArgs, input: "inputs/cypress/x.cy.js" });
    const prompt = buildPrompt(p, "qa-master", snap);
    assert.match(prompt, /CLOSED VOCABULARY/, "grounding block header present");
    assert.match(prompt, /MUST cite\s+\n?\s*a node that appears VERBATIM/i, "closed-vocab rule present");
    assert.match(prompt, /button "Login"/, "real snapshot content injected");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildPrompt: no DOM grounding block when snapshot is null (ungrounded, unchanged)", () => {
  const p = derivePaths({ ...baseArgs, input: "inputs/cypress/x.cy.js" });
  const prompt = buildPrompt(p, "qa-master", null);
  assert.ok(!prompt.includes("CLOSED VOCABULARY"), "ungrounded prompt must not carry a grounding block");
});
