#!/usr/bin/env tsx
/** Unit coverage for the Playwright assertion-strength AST core (B1). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractPwAssertions, compareStrength, MATCHER_TIER } from "./assertion-ast.js";

test("extractPwAssertions: pulls target, matcher, negation, anchor, tier (incl. await + nested parens)", () => {
  const src = `
    await expect(page.getByTestId('cart-badge')).toHaveText('3');
    await expect(page.getByRole('button', { name: 'Login' })).not.toBeVisible();
    expect.soft(page.locator('.flash')).toContainText('invalid');
  `;
  const a = extractPwAssertions(src);
  assert.equal(a.length, 3);
  const badge = a.find((x) => x.matcher === "toHaveText");
  assert.equal(badge?.anchor, "3");
  assert.equal(badge?.tier, 4);
  assert.equal(badge?.negated, false);
  const login = a.find((x) => x.matcher === "toBeVisible");
  assert.equal(login?.negated, true, "the .not chain must be detected");
  assert.equal(login?.anchor, null, "toBeVisible has no literal anchor");
  assert.match(a.find((x) => x.matcher === "toContainText")?.target ?? "", /\.flash/);
});

test("extractPwAssertions: ignores non-expect calls + unknown matchers", () => {
  assert.equal(extractPwAssertions("page.getByRole('button').click();").length, 0);
  assert.equal(extractPwAssertions("foo(x).toHaveText('y');").length, 0, "must be rooted at expect()");
});

test("MATCHER_TIER: the lattice orders exact > partial > state > presence", () => {
  const t = (m: string): number => MATCHER_TIER[m] ?? 0;
  assert.ok(t("toHaveText") > t("toContainText"));
  assert.ok(t("toContainText") > t("toBeChecked"));
  assert.ok(t("toBeChecked") > t("toBeVisible"));
});

test("compareStrength: clean when assertions are unchanged (locator may differ, anchor preserved)", () => {
  const before = extractPwAssertions("await expect(page.getByLabel('Username')).toHaveValue('bob');");
  // locator repaired getByLabel → getByPlaceholder, SAME matcher + anchor → not a weakening
  const after = extractPwAssertions("await expect(page.getByPlaceholder('Username')).toHaveValue('bob');");
  assert.deepEqual(compareStrength(before, after), []);
});

test("compareStrength: STRENGTH-DROP — toHaveText('3') → toBeVisible() (the canonical weakening)", () => {
  const before = extractPwAssertions("await expect(b).toHaveText('3');");
  const after = extractPwAssertions("await expect(b).toBeVisible();");
  assert.ok(compareStrength(before, after).some((x) => x.kind === "strength-drop"), "tier 4 → 1 must flag");
});

test("compareStrength: STRENGTH-DROP — toHaveText('3') → toContainText('3') (exact → partial)", () => {
  const before = extractPwAssertions("await expect(b).toHaveText('3');");
  const after = extractPwAssertions("await expect(b).toContainText('3');");
  assert.ok(compareStrength(before, after).some((x) => x.kind === "strength-drop"));
});

test("compareStrength: STRENGTH-DROP catches replace-one-strong-with-two-weak (count UP, sum DOWN)", () => {
  const before = extractPwAssertions("await expect(b).toHaveText('Order placed');"); // sum 4
  const after = extractPwAssertions("await expect(a).toBeVisible(); await expect(c).toBeVisible();"); // sum 2
  assert.ok(compareStrength(before, after).some((x) => x.kind === "strength-drop"));
});

test("compareStrength: ADDING an assertion is NOT a violation (sum goes UP)", () => {
  const before = extractPwAssertions("await expect(b).toHaveText('3');");
  const after = extractPwAssertions("await expect(b).toHaveText('3'); await expect(p).toBeVisible();");
  assert.deepEqual(compareStrength(before, after), [], "a stronger/extra assertion must not be flagged");
});

test("compareStrength: COUNT-DROP — an assertion was removed", () => {
  const before = extractPwAssertions("expect(a).toBeVisible(); expect(b).toHaveText('x');");
  const after = extractPwAssertions("expect(a).toBeVisible();");
  assert.ok(compareStrength(before, after).some((x) => x.kind === "count-drop"));
});

test("compareStrength: NEGATION-DROP — a .not assertion was flipped/removed", () => {
  const before = extractPwAssertions("await expect(badge).not.toBeVisible();");
  const after = extractPwAssertions("await expect(badge).toBeVisible();");
  assert.ok(compareStrength(before, after).some((x) => x.kind === "negation-drop"));
});
