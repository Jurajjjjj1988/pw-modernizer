#!/usr/bin/env node
/**
 * index-plans.test.ts — regression coverage for verdictFromReportBody, the
 * function that decides whether a past migration is a retrieval candidate.
 *
 * The subtle part is the confidence fallback (tier 2): real `outputs/plans`
 * reports never carry an explicit `Verdict:` header — only an
 * `Aggregate confidence:` line — so without the fallback the entire real corpus
 * parses as `unknown` and is excluded from RAG. A silent bug here would empty
 * the retrieval pool back down to the 16 goldens.
 *
 * Run:  npx tsx --test scripts/index-plans.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { verdictFromReportBody } from "./index-plans.js";

test("explicit Verdict header wins, bolded or not", () => {
  assert.equal(verdictFromReportBody("Verdict: **SHIP IT**\n"), "SHIP IT");
  assert.equal(verdictFromReportBody("- Verdict: FIX FIRST\n"), "FIX FIRST");
  assert.equal(verdictFromReportBody("Verdict: **START OVER**\n"), "START OVER");
});

test("explicit verdict takes precedence over a conflicting confidence line", () => {
  // A verify run that says FIX FIRST must not be overridden by a high score.
  const body = "Verdict: **FIX FIRST**\n- **Aggregate confidence:** 0.95\n";
  assert.equal(verdictFromReportBody(body), "FIX FIRST");
});

test("no Verdict header → confidence >= 0.7 derives a de-facto SHIP IT", () => {
  // The real outputs/plans report shape — only the aggregate line is present.
  assert.equal(verdictFromReportBody("- **Aggregate confidence:** 0.81\n"), "SHIP IT");
  assert.equal(verdictFromReportBody("Aggregate confidence: 0.70\n"), "SHIP IT");
});

test("no Verdict header → confidence < 0.7 stays unknown (would have fired verify)", () => {
  // Below the 0.7 fire threshold the migration was NOT auto-shipped — exclude it.
  assert.equal(verdictFromReportBody("- **Aggregate confidence:** 0.69\n"), "unknown");
});

test("a report with neither signal is unknown, not a false SHIP IT", () => {
  assert.equal(verdictFromReportBody("# Migration report\nsome prose\n"), "unknown");
});
