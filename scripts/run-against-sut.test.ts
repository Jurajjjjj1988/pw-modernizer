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
