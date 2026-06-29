#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { flakeVerdict, flakeRunsFromEnv } from "./flake-rate.js";

// ---- GOOD: all N repetitions pass deterministically → green.

test("all N pass (repeat-each tally shows N passes, exit 0) → GREEN", () => {
  // `--repeat-each=5` of one test reports a single combined tally line: "5 passed".
  const v = flakeVerdict("Running 5 tests using 1 worker\n  5 passed (12.3s)", 0, 5);
  assert.deepEqual(v, { ran: true, green: true, passedN: 5 });
});

test("N=1 reproduces the single-run green (default behaviour, no regression)", () => {
  const v = flakeVerdict("  1 passed (3.2s)", 0, 1);
  assert.deepEqual(v, { ran: true, green: true, passedN: 1 });
});

// ---- BAD: a mixed / coin-flip tally must NOT be accepted as green.

test("coin-flip run (some reps flaky) is NOT green", () => {
  // 5 reps, one needed a retry → playwright marks it flaky: never deterministically green.
  const v = flakeVerdict("  4 passed (10s)\n  1 flaky", 0, 5);
  assert.equal(v.green, false, "a flaky repetition must block acceptance");
});

test("mixed pass/fail tally is NOT green (and is repairable, i.e. it ran)", () => {
  const v = flakeVerdict("  3 passed (9s)\n  2 failed", 1, 5);
  assert.deepEqual(v, { ran: true, green: false, passedN: 3 });
});

test("fewer passes than reps (some did-not-run) is NOT green", () => {
  // Even with no explicit failure bucket, passedN < n means not every repetition passed.
  const v = flakeVerdict("  3 passed (6s)\n  2 did not run", 0, 5);
  assert.equal(v.green, false, "pass count must cover every repetition");
});

test("a single pass cannot satisfy a multi-rep run (passedN < n)", () => {
  // Hypothetical truncated tally: 1 passed but we demanded 5 reps.
  const v = flakeVerdict("  1 passed (2s)", 0, 5);
  assert.deepEqual(v, { ran: true, green: false, passedN: 1 });
});

// ---- infra error passes through (delegated to parsePlaywrightVerdict).

test("missing browser → could NOT run (not a flaky verdict)", () => {
  const v = flakeVerdict("Error: Executable doesn't exist at /ms-playwright/chromium", 1, 5);
  assert.deepEqual(v, { ran: false, green: false, passedN: 0 });
});

// ---- env gate: default 1, malformed floors to 1.

test("flakeRunsFromEnv default is 1 (preserves current single-run cost)", () => {
  assert.equal(flakeRunsFromEnv({}), 1);
});
test("flakeRunsFromEnv reads a valid positive integer", () => {
  assert.equal(flakeRunsFromEnv({ PWM_FLAKE_RUNS: "7" }), 7);
});
test("flakeRunsFromEnv floors zero / negative / garbage to 1 (never disables the gate)", () => {
  assert.equal(flakeRunsFromEnv({ PWM_FLAKE_RUNS: "0" }), 1);
  assert.equal(flakeRunsFromEnv({ PWM_FLAKE_RUNS: "-3" }), 1);
  assert.equal(flakeRunsFromEnv({ PWM_FLAKE_RUNS: "abc" }), 1);
  assert.equal(flakeRunsFromEnv({ PWM_FLAKE_RUNS: "" }), 1);
});

// ---- n itself is defensive: a non-positive reps floors to 1 inside flakeVerdict.

test("flakeVerdict treats n<1 as 1 (so a bad caller cannot fake a green via reps=0)", () => {
  const v = flakeVerdict("  1 passed (1s)", 0, 0);
  assert.deepEqual(v, { ran: true, green: true, passedN: 1 });
});
