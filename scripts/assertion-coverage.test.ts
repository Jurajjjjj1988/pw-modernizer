#!/usr/bin/env tsx
/** Unit tests for the source-equivalence (assertion-coverage) matcher. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { assertionCoverage, coverAssertion } from "./assertion-coverage.js";

const norm = (s: string): [string, string] => [
  s.toLowerCase().replaceAll(/[^a-z0-9]+/g, " "),
  s.toLowerCase().replaceAll(/[^a-z0-9]+/g, ""),
];

test("covered: the asserted literal text appears in the output", () => {
  const [n, sq] = norm("await expect(this.errorBanner).toContainText('Invalid credentials');");
  const v = coverAssertion("error banner shows 'Invalid credentials'", "s1", n, sq);
  assert.ok(v.checkable && v.covered);
});

test("GAP: a dropped assertion — the expected literal is absent from the output", () => {
  const [n, sq] = norm("await expect(this.dashboard).toBeVisible();"); // no error text at all
  const v = coverAssertion("error banner shows 'Invalid credentials'", "s1", n, sq);
  assert.ok(v.checkable && !v.covered, "an absent asserted text must be a gap");
});

test("generalisation is NOT a gap: 'welcome back, jane' covered by /welcome back/i", () => {
  const [n, sq] = norm("readonly greeting = this.page.getByRole('heading', { name: /welcome back/i });");
  const v = coverAssertion("greeting text matches /welcome back, jane/i", "s1", n, sq);
  assert.ok(v.covered, "dropping the dynamic name is a correct generalisation, not a dropped assertion");
});

test("intent-only assertions (no literal anchor) are not checkable, never flagged", () => {
  const [n, sq] = norm("await expect(this.x).toBeVisible();");
  const v = coverAssertion("dashboard greeting is visible after submit", "s1", n, sq);
  assert.equal(v.checkable, false);
  assert.equal(v.covered, true);
});

test("GAP: a dropped money assertion is NOT falsely covered by an unrelated digit run (4200 vs 42.00)", () => {
  // The migration dropped the cart-total check; the output only has an unrelated
  // 4200 (a viewport width). The squashed tree contains "42" and "00" as
  // SUBSTRINGS of "4200" — that must not pass for a digit-bearing anchor.
  const [n, sq] = norm("await this.page.setViewportSize({ width: 4200, height: 800 });");
  const v = coverAssertion("cart total equals '$42.00'", "s1", n, sq);
  assert.ok(v.checkable, "a price anchor is checkable");
  assert.equal(v.covered, false, "a digit anchor must boundary-match, not substring-match an unrelated digit run");
});

test("covered: a correctly-kept money assertion '$42.00' boundary-matches the real total", () => {
  // The dot in 42.00 is a non-alphanumeric separator, so the output yields the
  // word-boundary tokens "42" and "00" — both present, so this is covered.
  const [n, sq] = norm("await expect(this.cartTotal).toContainText('$42.00');");
  const v = coverAssertion("cart total equals '$42.00'", "s1", n, sq);
  assert.ok(v.checkable && v.covered, "the genuine total must still count as covered");
});

test("alpha squashed path is preserved: camelCase 'loginButton' covered by split 'login button'", () => {
  // The lenient substring/squashed path exists for pure-alpha camelCase tokens.
  // Gating the new boundary rule on digit tokens only must NOT lower this bound.
  const [n, sq] = norm("readonly loginButton = this.page.getByRole('button', { name: 'Log in' });");
  const v = coverAssertion("the 'loginButton' is present", "s1", n, sq);
  assert.ok(v.checkable && v.covered, "a pure-alpha token may still match across a separator via the squashed tree");
});

test("assertionCoverage aggregates: 1 covered, 1 gap, 1 intent-only skipped", () => {
  const env = {
    inputBasename: "x.spec.ts",
    scenarios: [
      { id: "login", expectedAssertions: [
        "error banner shows 'Invalid credentials'",
        "cart total equals '$42.00'",
        "page is loaded",
      ] },
    ],
  };
  const emitted = "await expect(this.banner).toContainText('Invalid credentials');";
  const rep = assertionCoverage(env, emitted);
  assert.equal(rep.total, 3);
  assert.equal(rep.checkable, 2); // the two with literal anchors
  assert.equal(rep.covered, 1);
  assert.equal(rep.gaps.length, 1);
  assert.match(rep.gaps[0]?.assertion ?? "", /42\.00/);
});
