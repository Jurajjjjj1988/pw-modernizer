#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlaywrightVerdict, buildSutArgs, runSpecAgainstSut } from "./run-against-sut.js";

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

// ---- ACCEPTANCE vs DIAGNOSIS retry split (acceptance-retries1).
// The two callers want opposite retry policies; buildSutArgs pins both.

test("ACCEPTANCE run emits --retries=1 (a retried pass ⇒ flaky ⇒ not accepted)", () => {
  // runSpecAgainstSut defaults retries to 1; emulate that default here.
  const args = buildSutArgs("foo.spec.ts", "chromium", 1, null);
  assert.ok(args.includes("--retries=1"), `acceptance must run --retries=1; got ${args.join(" ")}`);
  assert.ok(!args.includes("--retries=0"), "acceptance must NOT run --retries=0");
});

test("DIAGNOSIS run emits --retries=0 (a clean single failure is the repair signal)", () => {
  const args = buildSutArgs("foo.spec.ts", "chromium", 0, null);
  assert.ok(args.includes("--retries=0"), `diagnosis must run --retries=0; got ${args.join(" ")}`);
  assert.ok(!args.includes("--retries=1"), "diagnosis must NOT retry — a retry would mask the captured error");
});

test("runSpecAgainstSut is exported and reachable (the acceptance entrypoint)", () => {
  // The 4th param (retries) defaults to 1, so callers that omit it — migrate-local's
  // validator wall + the standalone run:sut gate — get acceptance (--retries=1, asserted
  // via buildSutArgs above), not diagnosis. Pin the function exists + is callable-shaped.
  assert.equal(typeof runSpecAgainstSut, "function");
});

test("buildSutArgs appends --config only when a config path is resolved", () => {
  const withCfg = buildSutArgs("foo.spec.ts", "chromium", 1, "outputs/tests/playwright.config.ts");
  assert.deepEqual(withCfg.slice(-2), ["--config", "outputs/tests/playwright.config.ts"]);
  const withoutCfg = buildSutArgs("foo.spec.ts", "chromium", 1, null);
  assert.ok(!withoutCfg.includes("--config"), "no config path ⇒ no --config flag");
});

test("buildSutArgs always emits an explicit --retries (never a silent config default)", () => {
  for (const r of [0, 1, 2]) {
    const args = buildSutArgs("foo.spec.ts", "chromium", r, null);
    assert.ok(args.includes(`--retries=${r}`), `retries=${r} must be emitted explicitly`);
  }
  // A bogus/negative retries collapses to 0 (never an unbounded retry on acceptance).
  assert.ok(buildSutArgs("f.spec.ts", "chromium", -3, null).includes("--retries=0"));
  assert.ok(buildSutArgs("f.spec.ts", "chromium", Number.NaN, null).includes("--retries=0"));
});

// The acceptance retry policy only WORKS because parsePlaywrightVerdict rejects a
// "1 flaky" tally — that is the tally --retries=1 produces on a fail-then-pass.
test("acceptance: a retried fail-then-pass surfaces as '1 flaky' and is NOT green", () => {
  const flakyTally = "Running 1 test\n  1 flaky\n    saucedemo › login (retry #1)\n";
  assert.deepEqual(parsePlaywrightVerdict(flakyTally, 0), { ran: true, passed: false },
    "retries=1 turns a flaky pass into '1 flaky'; the verdict must reject it (not accept a false green)");
});
