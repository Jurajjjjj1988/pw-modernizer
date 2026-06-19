#!/usr/bin/env node
/**
 * triage-all.test.ts — regression coverage for triage-all's digest parsers.
 * They scrape the DIGEST.md format capture-failure.ts emits; a format drift
 * would silently blank the index table.
 *
 * Run:  npx tsx --test scripts/triage-all.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { anomaliesOf, titleOf, verdictOf } from "./triage-all.js";

const DIGEST = [
  "# Triage digest — PR #126",
  "",
  "- [Migration code] inputs/cypress/wishlist.cy.js",
  "- verdict: **START OVER**   labels: migrator:code, verify:start-over",
  "- source: inputs/cypress/wishlist.cy.js  →  output: outputs/tests/wishlist.spec.ts",
  "",
  "## Anomalies (deterministic — fix locally, no cloud)",
  "- [low-plan-confidence] plan avg 0.43 (< 0.5)",
  "- [residual-smell] magicNumbers still 2 in output",
].join("\n");

test("verdictOf: extracts the bold verdict value", () => {
  assert.equal(verdictOf(DIGEST), "START OVER");
  assert.equal(verdictOf("no verdict here"), "?");
});

test("anomaliesOf: collects the [kind] tokens", () => {
  assert.deepEqual(anomaliesOf(DIGEST), ["low-plan-confidence", "residual-smell"]);
  assert.deepEqual(anomaliesOf("# digest\n\nno anomalies"), []);
});

test("titleOf: pulls the [Migration ...] first bullet", () => {
  assert.equal(titleOf(DIGEST), "[Migration code] inputs/cypress/wishlist.cy.js");
  assert.equal(titleOf("# digest\n- not a migration line"), "");
});
