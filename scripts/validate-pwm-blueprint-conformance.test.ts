#!/usr/bin/env node
/**
 * validate-pwm-blueprint-conformance.test.ts — pins two audit-confirmed gaps:
 *
 * (a) FAIL-CLOSED on a zero-spec scope miss. When `--input-basename` is set but
 *     pure-basename scoping resolves 0 specs, the validator historically passed
 *     VACUOUSLY (every spec-scoped check ran over an empty list). It now recovers
 *     via provenance (findGeneratedSpec) and, if that still finds nothing, emits
 *     `::error::… refusing to pass vacuously` and exits 1.
 *
 * (b) WIDENED W2 (no-try-catch). The try/catch-around-action smell was scanned
 *     in page/block files only; specs + actions are now covered too. The
 *     line-start `try {` regex still ignores the `.catch(() => {})` idiom.
 *
 * Pure core `resolveScopedSpecs` is unit-tested directly; the CLI behaviour is
 * exercised by spawning the validator over throwaway pwm-blueprint trees.
 *
 * Run:  npx tsx --test scripts/validate-pwm-blueprint-conformance.test.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { resolveScopedSpecs } from "./validate-pwm-blueprint-conformance.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const VALIDATOR = join(REPO_ROOT, "scripts", "validate-pwm-blueprint-conformance.ts");

interface RunResult {
  out: string;
  code: number;
}

/** Materialise `files` (relative path → contents) under a temp root, run the
 * validator with `extraArgs`, and return combined output + exit code. */
function runOverTree(files: Record<string, string>, extraArgs: string[] = []): RunResult {
  const root = mkdtempSync(join(tmpdir(), "pwm-conf-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, body);
    }
    const r = spawnSync("npx", ["tsx", VALIDATOR, "--root", root, ...extraArgs], {
      cwd: REPO_ROOT, encoding: "utf8",
    });
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status ?? -1 };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SPEC_BAD_IMPORT = [
  "// See outputs/plans/test_x.py.md",
  'import { test, expect } from "@playwright/test";',
  'test.describe("Auth", () => {',
  '  test("[QA-9] - Check that the user signs in", async ({ page }) => {',
  "    await expect(page).toHaveURL(/login/);",
  "  });",
  "});",
  "",
].join("\n");

const CLEAN_SPEC = [
  'import { test, expect } from "@fixtures/base.fixture";',
  'test.describe("Home", () => {',
  '  test("[QA-1] - Check that the home page loads", async ({ homePage }) => {',
  "    await homePage.open();",
  '    await expect(homePage.textTitle, "[Home] title visible").toBeVisible();',
  "  });",
  "});",
  "",
].join("\n");

// ---- (a) pure core: resolveScopedSpecs --------------------------------------

test("(a) resolveScopedSpecs: basename matches short-circuit before any FS read", () => {
  const r = resolveScopedSpecs("/nonexistent/tests", "login.spec.ts", ["/x/tests/login.spec.ts"]);
  assert.deepEqual(r, { specs: ["/x/tests/login.spec.ts"], scopeMiss: false });
});

test("(a) resolveScopedSpecs: zero basename matches + no spec on disk → scopeMiss", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-scope-"));
  try {
    mkdirSync(join(root, "tests"), { recursive: true });
    const r = resolveScopedSpecs(join(root, "tests"), "foo.py", []);
    assert.equal(r.scopeMiss, true, "an empty tree must be a scope miss, never a vacuous pass");
    assert.deepEqual(r.specs, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("(a) resolveScopedSpecs: provenance recovers a free-named spec (no basename match)", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-prov-"));
  try {
    const tests = join(root, "tests");
    mkdirSync(tests, { recursive: true });
    // input test_x.py, spec free-named x.spec.ts — the validator's local
    // basename scoping misses it, but findGeneratedSpec resolves it.
    writeFileSync(join(tests, "x.spec.ts"), SPEC_BAD_IMPORT);
    const r = resolveScopedSpecs(tests, "test_x.py", []);
    assert.equal(r.scopeMiss, false, "provenance recovery must rescue the free-named spec");
    assert.equal(r.specs.length, 1);
    assert.ok(r.specs[0]?.endsWith("x.spec.ts"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- (a) CLI: fail-closed + provenance rejection ----------------------------

test("(a) CLI: zero-spec scope miss emits the vacuous-pass refusal and exits 1", () => {
  const r = runOverTree({ "tests/.keep": "" }, ["--input-basename", "foo.py"]);
  assert.equal(r.code, 1, "a scope miss must fail closed, not pass vacuously");
  assert.match(r.out, /resolved 0 specs under outputs\/tests — refusing to pass vacuously/);
});

test("(a) CLI: provenance resolves the free-named spec and rejects its @playwright/test import", () => {
  const r = runOverTree({ "tests/x.spec.ts": SPEC_BAD_IMPORT }, ["--input-basename", "test_x.py"]);
  assert.equal(r.code, 1, "the recovered spec's bad import must block");
  assert.match(r.out, /architecture\/import-source/, "the planted import violation must fire");
});

test("(a) CLI: WITHOUT --input-basename the run is unscoped and unaffected (default behaviour)", () => {
  const r = runOverTree({ "tests/x.spec.ts": CLEAN_SPEC });
  assert.equal(r.code, 0, "a clean tree with no --input-basename must still pass");
  assert.match(r.out, /checked — clean\./);
});

// ---- (b) widened W2: try/catch in spec + action; .catch idiom preserved ------

const SPEC_TRY_CATCH = [
  'import { test, expect } from "@fixtures/base.fixture";',
  'test.describe("Checkout", () => {',
  '  test("[QA-7] - Check that the order completes", async ({ checkoutPage }) => {',
  "    try {",
  "      await checkoutPage.placeOrder();",
  "    } catch {",
  "      // swallow",
  "    }",
  '    await expect(checkoutPage.textDone, "[Checkout] done").toBeVisible();',
  "  });",
  "});",
  "",
].join("\n");

const SPEC_CATCH_IDIOM = [
  'import { test, expect } from "@fixtures/base.fixture";',
  'test.describe("Cart", () => {',
  '  test("[QA-3] - Check that the item is added", async ({ cartPage }) => {',
  "    await cartPage.addFirstItem().catch(() => {});",
  '    await expect(cartPage.textBadge, "[Cart] badge").toHaveText("1");',
  "  });",
  "});",
  "",
].join("\n");

const ACTION_TRY_CATCH = [
  'import { PageClassLogin } from "@page-object/pages/login.page";',
  "export async function signInFlow({ page }: { page: import('@playwright/test').Page }): Promise<void> {",
  "  const login = new PageClassLogin(page);",
  "  try {",
  "    await login.signIn();",
  "  } catch {",
  "    // swallow",
  "  }",
  "}",
  "",
].join("\n");

test("(b) W2 widened: a spec wrapping an action in try/catch is flagged + blocks under --block-defects", () => {
  const warn = runOverTree({ "tests/checkout.spec.ts": SPEC_TRY_CATCH });
  assert.match(warn.out, /no-try-catch/, "the spec try/catch must be reported (W2 now covers specs)");
  assert.equal(warn.code, 0, "default mode: W2 is warn-only → exit 0 (calibration-preserving)");
  const blocked = runOverTree({ "tests/checkout.spec.ts": SPEC_TRY_CATCH }, ["--block-defects"]);
  assert.equal(blocked.code, 1, "--block-defects: the spec try/catch defect blocks");
  assert.match(blocked.out, /quality-defect/);
});

test("(b) W2 widened: the .catch(() => {}) idiom in a spec is NOT flagged", () => {
  const r = runOverTree({ "tests/cart.spec.ts": SPEC_CATCH_IDIOM });
  assert.ok(!/no-try-catch/.test(r.out), "a chained .catch() is not a try-block — must stay clean");
  assert.equal(r.code, 0);
});

test("(b) W2 widened: a try/catch inside an action helper is flagged", () => {
  const r = runOverTree({ "helper/actions/sign-in-flow.ts": ACTION_TRY_CATCH });
  assert.match(r.out, /no-try-catch/, "actions are now in W2 scope too");
});
