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

test("compareStrength: RETARGET — strong matcher's anchor moved to another target; original kept but downgraded (sum UP, count UP — aggregate guards are blind)", () => {
  const before = extractPwAssertions(
    "await expect(page.getByTestId('cart-badge')).toHaveText('3');",
  );
  // Repair points toHaveText('3') at a trivially-true element while cart-badge is left with only a presence check.
  const after = extractPwAssertions(
    "await expect(page.getByTestId('cart-badge')).toBeVisible(); await expect(page.getByTestId('page-title')).toHaveText('3');",
  );
  const v = compareStrength(before, after);
  // Aggregate-only guards do NOT fire here: count 1→2 (up), sum 4→5 (up), no negation change.
  assert.equal(v.filter((x) => x.kind === "count-drop" || x.kind === "strength-drop" || x.kind === "negation-drop").length, 0, "this attack is invisible to the sum/count/negation guards");
  assert.ok(v.some((x) => x.kind === "retarget"), "the re-targeting must be flagged on target identity, not anchor presence");
});

test("compareStrength: RETARGET passes a SAME-TARGET value correction toHaveText('3') → toHaveText('2') (the JSDoc-safe case)", () => {
  const before = extractPwAssertions("await expect(page.getByTestId('cart')).toHaveText('3');");
  const after = extractPwAssertions("await expect(page.getByTestId('cart')).toHaveText('2');");
  assert.deepEqual(compareStrength(before, after), [], "same target, same tier, corrected value is not a weakening");
});

test("compareStrength: RETARGET passes a LOCATOR-only fix (same anchor + tier, different selector — anchor legitimately rides the repaired locator)", () => {
  const before = extractPwAssertions("await expect(page.getByLabel('Username')).toHaveValue('bob');");
  const after = extractPwAssertions("await expect(page.getByPlaceholder('Username')).toHaveValue('bob');");
  assert.deepEqual(compareStrength(before, after), [], "a 1:1 locator swap replaces the original target — not a retarget");
});

test("compareStrength: RETARGET does not fire on a same-target value correction even when a sibling assertion shares the new value", () => {
  // The corrected value '2' also appears on a different, pre-existing target — but the original
  // target keeps its strong assertion (toHaveText('2')), so no retarget is flagged.
  const before = extractPwAssertions(
    "await expect(page.getByTestId('cart')).toHaveText('3'); await expect(page.getByTestId('total')).toHaveText('2');",
  );
  const after = extractPwAssertions(
    "await expect(page.getByTestId('cart')).toHaveText('2'); await expect(page.getByTestId('total')).toHaveText('2');",
  );
  assert.equal(compareStrength(before, after).filter((x) => x.kind === "retarget").length, 0);
});
