#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { transformCypress, KEY_SEQUENCE_MARKER } from "./cypress-codemod.js";

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

test("key-sequence .type('{enter}') is NOT fill()'d — left for the LLM + marked", () => {
  const out = transformCypress("cy.get('#user').type('tom{enter}');");
  // The whole cy.get(...).type(...) stays verbatim — NOT lowered to fill() or page.locator().
  assert.match(out, /cy\.get\('#user'\)\.type\('tom\{enter\}'\)/, "key-sequence type left untransformed");
  assert.doesNotMatch(out, /\.fill\(/, "must not literal-fill a key sequence");
  assert.doesNotMatch(out, /page\.locator\('#user'\)/, "bare cy.get rewrite must not touch the shielded call");
  // The CODEMOD marker is prepended so the LLM tail knows to lower it.
  assert.ok(out.includes(KEY_SEQUENCE_MARKER), "marker present");
  assert.ok(out.includes(`${KEY_SEQUENCE_MARKER}\ncy.get`), "marker on its own line directly above the call");
});

test("key-sequence marker keeps the call's indentation + restores cyCallsLeft visibility", () => {
  const src = [
    "describe('x', () => {",
    "  it('y', () => {",
    "    cy.get('#user').type('hi{selectall}{backspace}');",
    "  });",
    "});",
  ].join("\n");
  const out = transformCypress(src);
  assert.match(out, /^ {4}\/\/ CODEMOD: Cypress key-sequence/m, "marker indented to match the call");
  assert.match(out, /^ {4}cy\.get\('#user'\)\.type\('hi\{selectall\}\{backspace\}'\)/m, "call kept at its indent");
});

test("plain .type('text') is STILL lowered to fill() (no regression, no marker)", () => {
  const out = transformCypress("cy.get('#user').type('plain text');");
  assert.match(out, /await page\.locator\('#user'\)\.fill\('plain text'\)/);
  assert.ok(!out.includes(KEY_SEQUENCE_MARKER), "no marker for a plain type");
});

test("IDEMPOTENT for key sequences: re-running does not double the marker", () => {
  const src = "cy.get('#a').type('x{enter}');";
  const once = transformCypress(src);
  const twice = transformCypress(once);
  assert.equal(twice, once);
  assert.equal(once.match(/CODEMOD: Cypress key-sequence/g)?.length, 1, "exactly one marker after re-run");
});
