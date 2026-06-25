#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJudgePrompt, parseScores, verdictFromScores } from "./judge.js";

test("judge prompt is reference-guided + has bias guards", () => {
  const p = buildJudgePrompt("cy.visit('/login')", "await page.goto('/login')");
  assert.match(p, /SOURCE.*reference/s);
  assert.match(p, /IGNORE length/);
  assert.match(p, /assertion-intent-preserved/);
});
test("parseScores picks the last valid axis JSON", () => {
  const out = 'The source verifies login.\n{"foo":1}\n{"readability":4,"idiomatic-playwright":5,"no-test-smells":4,"assertion-intent-preserved":5}';
  assert.deepEqual(parseScores(out), { readability:4, "idiomatic-playwright":5, "no-test-smells":4, "assertion-intent-preserved":5 });
});
test("parseScores returns null when no complete axis object", () => {
  assert.equal(parseScores('{"readability":4}'), null);
});
test("verdict: all>=3 and assertion-intent>=4 → acceptable; a dropped-assertion (intent=2) → not", () => {
  assert.equal(verdictFromScores({readability:4,"idiomatic-playwright":4,"no-test-smells":3,"assertion-intent-preserved":4}).acceptable, true);
  assert.equal(verdictFromScores({readability:5,"idiomatic-playwright":5,"no-test-smells":5,"assertion-intent-preserved":2}).acceptable, false);
});
