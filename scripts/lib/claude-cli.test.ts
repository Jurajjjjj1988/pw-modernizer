#!/usr/bin/env tsx
/** Unit coverage for the claude-cli timeout DETECTION (the rest is I/O, proven by
 * the end-to-end CLAUDE_CLI_TIMEOUT_MS=3000 run). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { wasTimeout } from "./claude-cli.js";

test("wasTimeout: an ETIMEDOUT error (spawnSync hit the timeout) → true", () => {
  const err = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" });
  assert.equal(wasTimeout({ error: err, status: null, signal: null }), true);
});

test("wasTimeout: killed by a signal with no exit status → true", () => {
  assert.equal(wasTimeout({ error: undefined, status: null, signal: "SIGTERM" }), true);
});

test("wasTimeout: a normal exit (status 0) is NOT a timeout", () => {
  assert.equal(wasTimeout({ error: undefined, status: 0, signal: null }), false);
});

test("wasTimeout: a normal NON-zero exit (the CLI failed cleanly) is NOT a timeout", () => {
  assert.equal(wasTimeout({ error: undefined, status: 1, signal: null }), false);
});

test("wasTimeout: a spawn ENOENT (binary missing) is not treated as a timeout", () => {
  const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  assert.equal(wasTimeout({ error: err, status: null, signal: null }), false);
});
