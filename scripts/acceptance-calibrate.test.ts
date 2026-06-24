#!/usr/bin/env tsx
/** Unit tests for the acceptance-calibration core (pure; no DB / files). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { calibrate, type LabeledPoint } from "./acceptance-calibrate.js";

test("calibrate: empty input yields the full [0,1] interval and no threshold", () => {
  const cal = calibrate([]);
  assert.equal(cal.n, 0);
  assert.deepEqual([cal.acceptanceRate.lo, cal.acceptanceRate.hi], [0, 1]);
  assert.equal(cal.best, null);
});

test("calibrate: acceptance rate counts ACCEPTABLE over labeled, with a Wilson CI", () => {
  const pts: LabeledPoint[] = [
    { input_basename: "a", acceptable: true, confidence: 0.8 },
    { input_basename: "b", acceptable: true, confidence: 0.75 },
    { input_basename: "c", acceptable: false, confidence: 0.6 },
    { input_basename: "d", acceptable: false, confidence: 0.65 },
    { input_basename: "e", acceptable: false, confidence: 0.5 },
  ];
  const cal = calibrate(pts);
  assert.equal(cal.acceptable, 2);
  assert.equal(cal.n, 5);
  assert.ok(Math.abs(cal.acceptanceRate.point - 0.4) < 1e-9);
  assert.ok(cal.acceptanceRate.lo < 0.2 && cal.acceptanceRate.hi > 0.7, "small-n CI must be wide");
});

test("calibrate: finds the threshold that perfectly separates acceptable from not", () => {
  // Acceptable iff confidence >= 0.7 here, so the best gate is ~0.7 with accuracy 1.
  const pts: LabeledPoint[] = [
    { input_basename: "a", acceptable: true, confidence: 0.72 },
    { input_basename: "b", acceptable: true, confidence: 0.9 },
    { input_basename: "c", acceptable: true, confidence: 0.7 },
    { input_basename: "d", acceptable: false, confidence: 0.69 },
    { input_basename: "e", acceptable: false, confidence: 0.5 },
    { input_basename: "f", acceptable: false, confidence: 0.6 },
  ];
  const cal = calibrate(pts);
  assert.ok(cal.best !== null);
  assert.equal(cal.best?.accuracy, 1, "a clean separation must reach accuracy 1.0");
  assert.ok((cal.best?.threshold ?? 0) > 0.69 && (cal.best?.threshold ?? 0) <= 0.72);
  assert.equal(cal.best?.youden, 1);
});

test("calibrate: surfaces how the shipped 0.7 gate scores (anti-correlation is visible)", () => {
  // Confidence is ANTI-correlated with acceptance here: the 0.7 gate is wrong.
  const pts: LabeledPoint[] = [
    { input_basename: "a", acceptable: false, confidence: 0.85 },
    { input_basename: "b", acceptable: false, confidence: 0.8 },
    { input_basename: "c", acceptable: true, confidence: 0.55 },
    { input_basename: "d", acceptable: true, confidence: 0.6 },
  ];
  const cal = calibrate(pts);
  // At 0.7: predicts a,b acceptable (both wrong), c,d not (both wrong) → accuracy 0.
  assert.equal(cal.atPoint7?.accuracy, 0, "the shipped gate is exactly wrong on anti-correlated data");
});
