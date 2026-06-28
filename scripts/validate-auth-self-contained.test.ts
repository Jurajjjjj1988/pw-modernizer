#!/usr/bin/env tsx
/**
 * Unit coverage for the auth-self-contained validator's pure core. The corpus
 * mirrors the real defect found by validating the closed loop on a GitHub test:
 * a storageState file referenced by a fixture that nothing in the tree produces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { storageStateRefs, hasStorageStateProducer, authVerdict } from "./validate-auth-self-contained.js";

test("storageStateRefs: catches the fixture form (use('x.json')) and the config form", () => {
  const fixture = 'const test = base.extend({ storageState: async ({}, use) => use("playwright/.auth/saucedemo.json") });';
  assert.deepEqual(storageStateRefs(fixture), ["playwright/.auth/saucedemo.json"]);
  const config = "use: { storageState: 'playwright/.auth/user.json' },";
  assert.deepEqual(storageStateRefs(config), ["playwright/.auth/user.json"]);
});

test("storageStateRefs: an INLINE storageState object is not a file ref", () => {
  const inline = "use: { storageState: { cookies: [], origins: [] } },";
  assert.deepEqual(storageStateRefs(inline), []);
});

test("storageStateRefs: de-dupes repeated references to the same file", () => {
  const src = 'storageState: "a.json"\n// later\nstorageState: "a.json"';
  assert.deepEqual(storageStateRefs(src), ["a.json"]);
});

test("hasStorageStateProducer: true only when a setup WRITES the file via storageState({ path })", () => {
  const producer = "await context.storageState({ path: 'playwright/.auth/saucedemo.json' });";
  assert.ok(hasStorageStateProducer([producer]));
  // a mere reference is not a producer
  assert.ok(!hasStorageStateProducer(['storageState: async ({}, use) => use("x.json")']));
});

test("authVerdict: PASS when no storageState file is referenced (inline login)", () => {
  const v = authVerdict([
    "test.beforeEach(async ({ loginPage }) => { await loginPage.login('standard_user', 'secret_sauce'); });",
  ]);
  assert.equal(v.selfContained, true);
  assert.match(v.reason, /inline auth/);
});

test("authVerdict: FAIL the real defect — storageState file referenced, no producer in the tree", () => {
  const v = authVerdict([
    'const test = base.extend({ storageState: async ({}, use) => use("playwright/.auth/saucedemo.json") });',
    "export class PageClassInventory extends BasePage { /* ... */ }",
  ]);
  assert.equal(v.selfContained, false);
  assert.deepEqual(v.refs, ["playwright/.auth/saucedemo.json"]);
  assert.match(v.reason, /NOTHING in the migrated tree creates it/);
});

test("authVerdict: PASS when the tree references AND produces the storageState file", () => {
  const v = authVerdict([
    "use: { storageState: 'playwright/.auth/user.json' },",
    "// auth.setup.ts\nawait page.context().storageState({ path: 'playwright/.auth/user.json' });",
  ]);
  assert.equal(v.selfContained, true);
  assert.equal(v.hasProducer, true);
  assert.match(v.reason, /produced by a setup writer/);
});
