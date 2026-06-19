#!/usr/bin/env node
/**
 * semantic-regression-check.test.ts — regression coverage for the verdict
 * math that gates the semantic-regression workflow (exit 0/1/2). These are
 * the pure functions; the markdown/IO plumbing around them is exercised by
 * the `regression-semantic.yml` workflow itself.
 *
 * Run:  npx tsx --test scripts/semantic-regression-check.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregate,
  bandToVerdict,
  confidenceDistance,
  regressionDiff,
} from "./semantic-regression-check.js";

interface AxisLike {
  name: string;
  status: "PASS" | "DEGRADED" | "FAIL";
  detail: string;
}

const axis = (status: AxisLike["status"]): AxisLike => ({ name: status, status, detail: "" });

test("bandToVerdict: at the PASS/DEGRADED boundary the better band wins (PASS)", () => {
  // distance exactly == passBand is still PASS (inclusive lower edge).
  assert.equal(bandToVerdict(0.2, 0.2, 0.5), "PASS");
  // a hair above passBand tips into DEGRADED.
  assert.equal(bandToVerdict(0.21, 0.2, 0.5), "DEGRADED");
});

test("bandToVerdict: at the DEGRADED/FAIL boundary the better band wins (DEGRADED)", () => {
  // distance exactly == failBand is still DEGRADED.
  assert.equal(bandToVerdict(0.5, 0.2, 0.5), "DEGRADED");
  // a hair above failBand tips into FAIL.
  assert.equal(bandToVerdict(0.51, 0.2, 0.5), "FAIL");
});

test("regressionDiff: finding the same-or-more is no regression (== 0)", () => {
  assert.equal(regressionDiff(8, 6), 0, "actual > expected → improved");
  assert.equal(regressionDiff(6, 6), 0, "actual == expected → no drift");
});

test("regressionDiff: missing smells is a regression (> 0)", () => {
  // actual 3 vs expected 6 → relativeDiff = |3-6|/6 = 0.5
  assert.ok(regressionDiff(3, 6) > 0);
  assert.equal(regressionDiff(3, 6), 0.5);
});

test("confidenceDistance: opposite distributions are maximally distant (== 1)", () => {
  const allHigh = { high: 4, med: 0, low: 0 };
  const allLow = { high: 0, med: 0, low: 4 };
  assert.equal(confidenceDistance(allHigh, allLow), 1);
});

test("confidenceDistance: identical distributions are zero distance (== 0)", () => {
  const dist = { high: 2, med: 1, low: 1 };
  assert.equal(confidenceDistance(dist, dist), 0);
});

test("aggregate: any FAIL axis makes the whole run FAIL", () => {
  assert.equal(aggregate([axis("PASS"), axis("DEGRADED"), axis("FAIL")]), "FAIL");
});

test("aggregate: a DEGRADED axis with no FAIL makes the run DEGRADED", () => {
  assert.equal(aggregate([axis("PASS"), axis("DEGRADED")]), "DEGRADED");
});

test("aggregate: all PASS axes make the run PASS", () => {
  assert.equal(aggregate([axis("PASS"), axis("PASS")]), "PASS");
});
