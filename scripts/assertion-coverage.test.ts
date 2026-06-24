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
