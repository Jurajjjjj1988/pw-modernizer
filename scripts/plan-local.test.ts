#!/usr/bin/env tsx
/** Unit tests for the local Stage-1 runner's pure path/prompt derivation + CLI shell. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { derivePaths, buildPrompt } from "./plan-local.js";

const SCRIPT = fileURLToPath(new URL("./plan-local.ts", import.meta.url));

test("derivePaths: input → outputs/plans/<base>.md + .envelope.json (Stage-2 convention)", () => {
  const p = derivePaths({ input: "inputs/cypress/checkout-flow.cy.js", mock: false, check: false, help: false });
  assert.equal(p.base, "checkout-flow.cy.js");
  assert.ok(p.plan.endsWith("outputs/plans/checkout-flow.cy.js.md"));
  assert.ok(p.envelope.endsWith("outputs/plans/checkout-flow.cy.js.envelope.json"));
});

test("buildPrompt: points Claude at analyze.md + the input + both output paths, forbids inventing KB-IDs", () => {
  const p = derivePaths({ input: "inputs/selenium-java/LoginTest.java", mock: false, check: false, help: false });
  const prompt = buildPrompt(p);
  assert.match(prompt, /Stage 1/);
  assert.match(prompt, /analyze\.md/);
  assert.match(prompt, /LoginTest\.java/);
  assert.match(prompt, /\.envelope\.json/);
  assert.match(prompt, /Do NOT invent KB-IDs/);
});

test("CLI --help prints usage and exits 0 without calling Claude", () => {
  const r = spawnSync("npx", ["tsx", SCRIPT, "--help"], { cwd: resolve(SCRIPT, "../.."), encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /npm run plan -- --input/);
  assert.match(r.stdout, /Stage 2 reads this plan/);
});
