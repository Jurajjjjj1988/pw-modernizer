#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFirstUnique, priorityRank } from "./resolve-locator.js";
test("pickFirstUnique returns the first count===1, skipping not-found and ambiguous", () => {
  const r = pickFirstUnique([
    { candidate: "getByLabel('Username')", count: 0 },
    { candidate: "getByText('x')", count: 3 },
    { candidate: "getByPlaceholder('Username')", count: 1 },
  ]);
  assert.equal(r?.candidate, "getByPlaceholder('Username')");
});
test("pickFirstUnique returns null when nothing resolves uniquely", () => {
  assert.equal(pickFirstUnique([{ candidate: "a", count: 0 }, { candidate: "b", count: 5 }]), null);
});
test("priorityRank orders role > label > placeholder > text > testid > css", () => {
  const sorted = ["page.locator('.x')","getByTestId('y')","getByPlaceholder('z')","getByRole('button')"].sort((a,b)=>priorityRank(a)-priorityRank(b));
  assert.deepEqual(sorted, ["getByRole('button')","getByPlaceholder('z')","getByTestId('y')","page.locator('.x')"]);
});
