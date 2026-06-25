#!/usr/bin/env tsx
/** Unit tests for the per-framework promotion-gate core (pure; no DB). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { summariseFrameworks, type MigrationPoint } from "./measure-framework.js";

test("every framework appears even with zero data (the gate names the gap)", () => {
  const rows = summariseFrameworks([]);
  const names = rows.map((r) => r.framework);
  for (const fw of ["bad-playwright", "cypress", "selenium-java", "selenium-python"]) {
    assert.ok(names.includes(fw), `${fw} must be reported even at 0 migrations`);
  }
  assert.ok(rows.every((r) => !r.promoted && r.migrations === 0));
});

test("a framework with too few labels is NOT promoted (interval too wide)", () => {
  const pts: MigrationPoint[] = [
    { input_basename: "a.cy.js", framework: "cypress", confidence: 0.8, acceptable: true },
    { input_basename: "b.cy.js", framework: "cypress", confidence: 0.75, acceptable: true },
  ];
  const cy = summariseFrameworks(pts, 0.7, 10).find((r) => r.framework === "cypress");
  assert.equal(cy?.labeled, 2);
  assert.equal(cy?.promoted, false, "2 labels can't clear a 70% bar with a min-n of 10");
  assert.match(cy?.reason ?? "", /need ≥10/);
});

test("a framework clears the bar only when the Wilson LOWER bound ≥ bar", () => {
  // 20/20 acceptable → lower bound well above 0.7 → promoted.
  const strong: MigrationPoint[] = Array.from({ length: 20 }, (_, i) => ({
    input_basename: `s${i}.cy.js`, framework: "cypress", confidence: 0.9, acceptable: true,
  }));
  const cy = summariseFrameworks(strong, 0.7, 10).find((r) => r.framework === "cypress");
  assert.equal(cy?.promoted, true);

  // 14/20 (70% point) → lower bound BELOW 0.7 → not promoted (point estimate isn't enough).
  const borderline: MigrationPoint[] = Array.from({ length: 20 }, (_, i) => ({
    input_basename: `b${i}.cy.js`, framework: "cypress", confidence: 0.8, acceptable: i < 14,
  }));
  const cy2 = summariseFrameworks(borderline, 0.7, 10).find((r) => r.framework === "cypress");
  assert.equal(cy2?.promoted, false, "a 70% point estimate has a lower bound below 0.7 — not promotable yet");
});

test("mean confidence + migration count are computed from the points", () => {
  const pts: MigrationPoint[] = [
    { input_basename: "x.spec.ts", framework: "bad-playwright", confidence: 0.6, acceptable: null },
    { input_basename: "y.spec.ts", framework: "bad-playwright", confidence: 0.8, acceptable: null },
  ];
  const bp = summariseFrameworks(pts).find((r) => r.framework === "bad-playwright");
  assert.equal(bp?.migrations, 2);
  assert.ok(Math.abs((bp?.meanConfidence ?? 0) - 0.7) < 1e-9);
  assert.equal(bp?.labeled, 0);
});
