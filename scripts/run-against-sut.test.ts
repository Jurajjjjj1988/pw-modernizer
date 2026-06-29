#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlaywrightVerdict } from "./run-against-sut.js";

test("green run (all passed, exit 0) → accepted", () => {
  const v = parsePlaywrightVerdict("Running 1 test\n  1 passed (3.2s)", 0);
  assert.deepEqual(v, { ran: true, passed: true });
});
test("ran but a test FAILED → ran, not passed (feeds repair loop)", () => {
  const v = parsePlaywrightVerdict("  1 failed\n    saucedemo › login\n  1 passed", 1);
  assert.deepEqual(v, { ran: true, passed: false });
});
test("missing browser/config → could NOT run (infra error, not a repairable failure)", () => {
  const v = parsePlaywrightVerdict("Error: Executable doesn't exist at /ms-playwright/chromium", 1);
  assert.equal(v.ran, false);
});
test("'No tests found' with no tally → could not run", () => {
  assert.equal(parsePlaywrightVerdict("No tests found", 1).ran, false);
});

// ---- false-green family: a green verdict must mean tests REALLY ran and passed.

test("passed-with-SKIPPED is NOT green (skipped tests masked as a pass)", () => {
  const v = parsePlaywrightVerdict("  1 passed (2.1s)\n  2 skipped", 0);
  assert.deepEqual(v, { ran: true, passed: false }, "skipped tests must not be accepted as green");
});
test("ALL-skipped run is NOT green (and it did run)", () => {
  const v = parsePlaywrightVerdict("  3 skipped (0.5s)", 0);
  assert.deepEqual(v, { ran: true, passed: false });
});
test("FLAKY pass is NOT green (non-deterministic)", () => {
  const v = parsePlaywrightVerdict("  1 passed (4s)\n  1 flaky", 0);
  assert.equal(v.passed, false);
});
test("INTERRUPTED / did-not-run is NOT green", () => {
  assert.equal(parsePlaywrightVerdict("  1 passed\n  2 interrupted", 0).passed, false);
  assert.equal(parsePlaywrightVerdict("  1 passed\n  1 did not run", 0).passed, false);
});
test("zero real passes (e.g. 'passed' only in a test title) is NOT green", () => {
  const v = parsePlaywrightVerdict("Running 1 test\n  › the form should be passed to the API\n  1 skipped", 0);
  assert.equal(v.passed, false, "the word 'passed' in output must not fake a pass without a real tally");
});
test("genuine multi-pass with nothing else → green", () => {
  assert.deepEqual(parsePlaywrightVerdict("  3 passed (5.0s)", 0), { ran: true, passed: true });
});
