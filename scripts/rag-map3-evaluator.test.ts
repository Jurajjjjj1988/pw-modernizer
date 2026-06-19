#!/usr/bin/env node
/**
 * rag-map3-evaluator.test.ts — regression coverage for the Phase 1
 * retrieval-quality verdict (ADR-0001 §6 exit criterion: held-out MAP@3 >= 0.6).
 * Pins the inclusive PASS boundary, the HOLD band just below it, and the
 * insufficient-data override that fires regardless of MAP.
 *
 * Run:  npx tsx --test scripts/rag-map3-evaluator.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveVerdict } from "./rag-map3-evaluator.js";

interface CliArgsLike {
  k: number;
  minQueries: number;
  json: boolean;
  quiet: boolean;
}

const args = (overrides: Partial<CliArgsLike> = {}): CliArgsLike => ({
  k: 3,
  minQueries: 5,
  json: false,
  quiet: true,
  ...overrides,
});

test("deriveVerdict: MAP exactly at the 0.6 threshold is PASS (inclusive)", () => {
  const { verdict } = deriveVerdict(0.6, 8, args());
  assert.equal(verdict, "PASS");
});

test("deriveVerdict: MAP just below threshold is HOLD", () => {
  const { verdict } = deriveVerdict(0.599, 8, args());
  assert.equal(verdict, "HOLD");
});

test("deriveVerdict: too few queries is INSUFFICIENT-DATA even with high MAP", () => {
  // count (4) < minQueries (5) overrides the otherwise-passing MAP of 0.95.
  const { verdict } = deriveVerdict(0.95, 4, args({ minQueries: 5 }));
  assert.equal(verdict, "INSUFFICIENT-DATA");
});
