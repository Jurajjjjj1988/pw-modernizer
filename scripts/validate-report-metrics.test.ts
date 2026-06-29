#!/usr/bin/env node
/**
 * validate-report-metrics.test.ts — regression coverage for the post-Stage-2
 * report/spec self-consistency gate (PR #13 copy-paste root cause). Covers:
 *   - basename derivation accepts the kebab spec, rejects a foreign one
 *   - the leading-`test-` strip so pytest migrations stop false-failing
 *     (latent bug ported from plan-envelope-validate.ts)
 *   - the LOC ±1 tolerance window
 *   - the source→output delta self-consistency check
 *
 * Run:  npx tsx --test scripts/validate-report-metrics.test.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkBasenameDerivation,
  checkLocConsistency,
  expectedSpecBasenames,
} from "./validate-report-metrics.js";

/**
 * Write a spec file whose `countLines` (== newline count) equals `loc`.
 * `loc` content lines each end in `\n`, giving exactly `loc` newlines and
 * no trailing partial line — deterministic regardless of editor settings.
 */
function writeSpecWithLoc(loc: number): string {
  const dir = mkdtempSync(join(tmpdir(), "vrm-"));
  const specPath = join(dir, "thing.spec.ts");
  const body = Array.from({ length: loc }, (_, i) => `// line ${i + 1}`).join("\n") + "\n";
  writeFileSync(specPath, body);
  return specPath;
}

const emitted = (claimedLoc: number | null, path = "outputs/tests/thing.spec.ts") => ({
  path,
  claimedLoc,
  line: 7,
});

test("checkBasenameDerivation: accepts the kebab spec derived from the Java input", () => {
  const v = checkBasenameDerivation(
    emitted(null, "outputs/tests/add-cookies-jupiter-test.spec.ts"),
    "AddCookiesJupiterTest.java",
    "report.md",
  );
  assert.deepEqual(v, []);
});

test("checkBasenameDerivation: rejects a foreign spec name (PR #13 copy-paste)", () => {
  const v = checkBasenameDerivation(
    emitted(null, "outputs/tests/search-filters.spec.ts"),
    "AddCookiesJupiterTest.java",
    "report.md",
  );
  assert.equal(v.length, 1);
  assert.match(v[0]?.message ?? "", /search-filters\.spec\.ts/);
});

test("expectedSpecBasenames: pytest test_ prefix maps to bare spec (latent-bug fix)", () => {
  // Before the leading-`test-` strip, this rejected the legitimate
  // employees.spec.ts and only accepted test-employees.spec.ts.
  assert.ok(expectedSpecBasenames("test_employees.py").includes("employees.spec.ts"));
});

test("checkBasenameDerivation: accepts employees.spec.ts for test_employees.py", () => {
  const v = checkBasenameDerivation(
    emitted(null, "outputs/tests/employees.spec.ts"),
    "test_employees.py",
    "report.md",
  );
  assert.deepEqual(v, []);
});

test("checkLocConsistency: claimed == actual+1 is within tolerance (passes)", () => {
  const specPath = writeSpecWithLoc(40); // actual LOC = 40
  const v = checkLocConsistency(emitted(41), specPath, "no LOC block here", "report.md");
  assert.deepEqual(v, []);
});

test("checkLocConsistency: claimed == actual+2 exceeds tolerance (fails)", () => {
  const specPath = writeSpecWithLoc(40); // actual LOC = 40
  const v = checkLocConsistency(emitted(42), specPath, "no LOC block here", "report.md");
  assert.equal(v.length, 1);
  assert.match(v[0]?.message ?? "", /42 LOC but actual file is 40/);
});

test("checkLocConsistency: a consistent source→output delta passes", () => {
  const specPath = writeSpecWithLoc(40); // actual LOC = 40, matches Output LOC
  const report = [
    "Source LOC: 52",
    "- `outputs/tests/thing.spec.ts` (40 LOC)",
    "LOC delta: -12", // 40 - 52 = -12, consistent
  ].join("\n");
  const v = checkLocConsistency(emitted(40), specPath, report, "report.md");
  assert.deepEqual(v, []);
});

test("checkLocConsistency: an inconsistent delta fails", () => {
  const specPath = writeSpecWithLoc(40); // actual LOC = 40, matches Output LOC
  const report = [
    "Source LOC: 52",
    "- `outputs/tests/thing.spec.ts` (40 LOC)",
    "LOC delta: -3", // computes -12, claimed -3 → |(-12) - (-3)| = 9 > 1
  ].join("\n");
  const v = checkLocConsistency(emitted(40), specPath, report, "report.md");
  assert.equal(v.length, 1);
  assert.match(v[0]?.message ?? "", /LOC delta claimed -3/);
});

test("checkLocConsistency: delta off-by-1 is within the harmonised tolerance (passes)", () => {
  const specPath = writeSpecWithLoc(40);
  const report = [
    "Source LOC: 52",
    "- `outputs/tests/thing.spec.ts` (40 LOC)",
    "LOC delta: -11", // computes -12, claimed -11 → |(-12) - (-11)| = 1, within ±1
  ].join("\n");
  assert.deepEqual(checkLocConsistency(emitted(40), specPath, report, "report.md"), []);
});

test("checkLocConsistency: delta off-by-2 now fails (the B4.2 tightening from ±2 → ±1)", () => {
  const specPath = writeSpecWithLoc(40);
  const report = [
    "Source LOC: 52",
    "- `outputs/tests/thing.spec.ts` (40 LOC)",
    "LOC delta: -10", // computes -12, claimed -10 → |(-12) - (-10)| = 2, was passing under ±2
  ].join("\n");
  const v = checkLocConsistency(emitted(40), specPath, report, "report.md");
  assert.equal(v.length, 1);
  assert.match(v[0]?.message ?? "", /LOC delta claimed -10/);
});
