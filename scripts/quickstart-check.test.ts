#!/usr/bin/env tsx
/**
 * Unit tests for quickstart-check's calibration-count claim.
 *
 * quickstart-check.ts prints "Validators calibrated (N validators, M fixtures)".
 * Those numbers are a documentation claim that silently rots when validators or
 * fixtures are added. This test re-derives N and M from the live calibration
 * registry (tools/calibrate-pipeline/run-calibration.ts VALIDATORS) and the
 * on-disk fixture corpus, then asserts the hardcoded label matches — so the
 * claim cannot drift without a red test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CALIBRATION_FIXTURE_COUNT,
  CALIBRATION_VALIDATOR_COUNT,
  calibrationStepLabel,
} from "./quickstart-check.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const CALIBRATION = join(REPO_ROOT, "tools", "calibrate-pipeline");
const FIXTURES_ROOT = join(CALIBRATION, "fixtures");

// The 4 validators whose fixtures live under nested {good,bad}/<scenario>/ dirs
// (mirrors NESTED_CONFORMANCE_VALIDATORS in run-calibration.ts). All others use
// flat good-*/bad-* entries directly under fixtures/<validator>/.
const NESTED = new Set([
  "cypress-conformance",
  "selenium-python-conformance",
  "selenium-java-conformance",
  "helper-usage",
]);

/** Parse the VALIDATORS readonly array literal out of run-calibration.ts. */
function liveValidators(): string[] {
  const src = readFileSync(join(CALIBRATION, "run-calibration.ts"), "utf8");
  const m = src.match(/const VALIDATORS:\s*readonly ValidatorName\[\]\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, "could not locate the VALIDATORS array in run-calibration.ts");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

/** Count fixtures for one validator the same way run-calibration.ts does. */
function countFixtures(validator: string): number {
  const dir = join(FIXTURES_ROOT, validator);
  if (!existsSync(dir)) return 0;
  if (NESTED.has(validator)) {
    let n = 0;
    for (const polarity of ["good", "bad"]) {
      const sub = join(dir, polarity);
      if (!existsSync(sub)) continue;
      for (const scenario of readdirSync(sub)) {
        if (statSync(join(sub, scenario)).isDirectory()) n += 1;
      }
    }
    return n;
  }
  return readdirSync(dir).filter((e) => e.startsWith("good-") || e.startsWith("bad-")).length;
}

test("CALIBRATION_VALIDATOR_COUNT matches the live run-calibration registry", () => {
  assert.equal(liveValidators().length, CALIBRATION_VALIDATOR_COUNT);
});

test("CALIBRATION_FIXTURE_COUNT matches the on-disk fixture corpus", () => {
  const total = liveValidators().reduce((sum, v) => sum + countFixtures(v), 0);
  assert.equal(total, CALIBRATION_FIXTURE_COUNT);
});

test("the step label states both the validator and fixture totals", () => {
  const label = calibrationStepLabel();
  assert.ok(label.includes(`${CALIBRATION_VALIDATOR_COUNT} validators`), label);
  assert.ok(label.includes(`${CALIBRATION_FIXTURE_COUNT} fixtures`), label);
});
