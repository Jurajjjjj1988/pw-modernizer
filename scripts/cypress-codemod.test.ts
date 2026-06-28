#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { transformCypress } from "./cypress-codemod.js";

const SRC = [
  "describe('login', () => {",
  "  it('logs in', () => {",
  "    cy.visit('/login');",
  "    cy.get('#user').type('tom');",
  "    cy.wait(1000);",
  "    cy.get('#submit').click();",
  "    cy.contains('Welcome');",
  "  });",
  "});",
].join("\n");

test("deterministic transforms: visit/get/type/click/contains/wait/describe/it", () => {
  const out = transformCypress(SRC);
  assert.match(out, /await page\.goto\('\/login'\)/);
  assert.match(out, /await page\.locator\('#user'\)\.fill\('tom'\)/);
  assert.match(out, /await page\.locator\('#submit'\)\.click\(\)/);
  assert.match(out, /page\.getByText\('Welcome'\)/);
  assert.doesNotMatch(out, /cy\.wait\(1000\)/, "numeric hard wait removed");
  assert.match(out, /test\.describe\('login'/);
  assert.match(out, /test\('logs in', async \(\{ page \}\) => \{/);
});

test("IDEMPOTENT: re-running makes no further change (no double-await)", () => {
  const once = transformCypress(SRC);
  const twice = transformCypress(once);
  assert.equal(twice, once);
  assert.doesNotMatch(once, /await await/);
});

test("network-sync cy.wait('@alias') is LEFT for the LLM (not deleted)", () => {
  const out = transformCypress("cy.wait('@save');");
  assert.match(out, /cy\.wait\('@save'\)/);
});
