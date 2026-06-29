/**
 * plan-envelope-validate.test.ts — pins the B4.1 scenario-coverage scoping fix.
 *
 * The defect: when `--code <dir>` was a directory and NO spec matched the
 * envelope's inputBasename, the validator fell back to checking ALL specs.
 * Scenario ids (1.1, 1.2 …) are shared across every migration, so an unrelated
 * spec satisfied coverage for an input whose spec was never emitted — a false
 * pass. The fix: single-file --code is honoured verbatim; a directory no-match
 * yields ONE honest "coverage cannot be verified" violation instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  expectedSpecBasenames,
  filterCodePathsByInput,
  validateScenarioCoverage,
  type Envelope,
} from "./plan-envelope-validate.js";

function mkEnvelope(inputBasename: string, scenarioIds: string[]): Envelope {
  return {
    inputBasename,
    sourceFramework: "bad-playwright",
    subtractive: true,
    scenarios: scenarioIds.map((id) => ({
      id,
      title: `scenario ${id}`,
      userAction: "act",
      expectedAssertions: ["asserts"],
    })),
    requiredPOMs: [],
    requiredFixtures: [],
    locatorTable: [],
    hallucinationDefensePins: [],
    expectedMetrics: { selectorQualityScore: 1, smellCountDelta: 0, locDelta: 0, antiPatternCoverage: "n/a" },
  };
}

test("expectedSpecBasenames drops trailing -test and leading test-", () => {
  assert.ok(expectedSpecBasenames("LoginTest.java").includes("login.spec.ts"));
  assert.ok(expectedSpecBasenames("test_employees.py").includes("employees.spec.ts"));
});

test("filterCodePathsByInput: single-file is honoured verbatim (matched=true, no basename gymnastics)", () => {
  const env = mkEnvelope("Whatever.java", ["1.1"]);
  const r = filterCodePathsByInput(env, ["/abs/some-unrelated-name.spec.ts"], true);
  assert.equal(r.matched, true);
  assert.deepEqual(r.scoped, ["/abs/some-unrelated-name.spec.ts"]);
});

test("filterCodePathsByInput: directory match by basename scopes to this input's spec", () => {
  const env = mkEnvelope("LoginTest.java", ["1.1"]);
  const r = filterCodePathsByInput(
    env,
    ["/o/tests/login.spec.ts", "/o/tests/checkout.spec.ts"],
    false,
  );
  assert.equal(r.matched, true);
  assert.deepEqual(r.scoped, ["/o/tests/login.spec.ts"]);
});

test("filterCodePathsByInput: directory NO-match returns matched=false + empty scoped (no fallback-to-all)", () => {
  const env = mkEnvelope("LoginTest.java", ["1.1"]);
  const r = filterCodePathsByInput(
    env,
    ["/o/tests/checkout.spec.ts", "/o/tests/search.spec.ts"],
    false,
  );
  assert.equal(r.matched, false);
  assert.deepEqual(r.scoped, []);
});

test("validateScenarioCoverage: directory no-match emits ONE honest 'cannot be verified' violation (the false-pass fix)", () => {
  const env = mkEnvelope("LoginTest.java", ["1.1", "1.2"]);
  // Unrelated specs that happen to share scenario ids would have falsely passed
  // under the old fallback-to-all. They don't even need to exist on disk — the
  // no-match branch returns before any file read.
  const out = validateScenarioCoverage(env, ["/o/tests/checkout.spec.ts"], false);
  assert.equal(out.length, 1);
  const [first] = out;
  assert.ok(first);
  assert.match(first.message, /no emitted spec matches envelope\.inputBasename 'LoginTest\.java'/);
  assert.match(first.message, /coverage cannot be verified/);
});

test("validateScenarioCoverage: single-file with correct pins is clean", () => {
  const dir = mkdtempSync(join(tmpdir(), "pev-"));
  try {
    const spec = join(dir, "login.spec.ts");
    writeFileSync(
      spec,
      [
        "import { test, expect } from '@fixtures/base.fixture';",
        "test('signs in', async ({ page }) => {",
        "  // plan:scenario=1.1",
        "  await expect(page).toHaveTitle(/ok/);",
        "});",
      ].join("\n"),
    );
    const env = mkEnvelope("LoginTest.java", ["1.1"]);
    assert.deepEqual(validateScenarioCoverage(env, [spec], true), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateScenarioCoverage: single-file missing a pin reports the uncovered scenario", () => {
  const dir = mkdtempSync(join(tmpdir(), "pev-"));
  try {
    const spec = join(dir, "login.spec.ts");
    writeFileSync(
      spec,
      [
        "import { test, expect } from '@fixtures/base.fixture';",
        "test('signs in', async ({ page }) => {",
        "  // plan:scenario=1.1",
        "  await expect(page).toHaveTitle(/ok/);",
        "});",
      ].join("\n"),
    );
    const env = mkEnvelope("LoginTest.java", ["1.1", "1.2"]);
    const out = validateScenarioCoverage(env, [spec], true);
    assert.equal(out.length, 1);
    const [first] = out;
    assert.ok(first);
    assert.match(first.message, /scenario id '1\.2' has no '\/\/ plan:scenario=1\.2' pin/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
