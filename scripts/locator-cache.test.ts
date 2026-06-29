#!/usr/bin/env tsx
/** Unit coverage for the per-app verified-locator cache (IMP6) pure core. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { appKey, mergeEntries, entriesFromReport, renderCacheHints } from "./locator-cache.js";

test("appKey: keys by host so all of an app shares one manifest; malformed → unknown-host", () => {
  assert.equal(appKey("https://www.saucedemo.com/inventory.html"), "www.saucedemo.com");
  assert.equal(appKey("https://the-internet.herokuapp.com/login"), "the-internet.herokuapp.com");
  assert.equal(appKey("not a url"), "unknown-host");
});

test("entriesFromReport: keeps ONLY resolved-unique locators (drops multiple/not-found/skipped)", () => {
  const report = {
    url: "https://x",
    results: [
      { locator: "getByPlaceholder('Username')", domVerdict: "resolved-unique", domEvidence: "textbox Username (1)" },
      { locator: "getByRole('button')", domVerdict: "resolved-multiple", domEvidence: "3 matches" },
      { locator: "getByText('nope')", domVerdict: "not-found", domEvidence: "0" },
      { locator: "locator('.x')", domVerdict: "skipped", domEvidence: "" },
    ],
  };
  const e = entriesFromReport(report);
  assert.equal(e.length, 1);
  assert.equal(e[0]?.locator, "getByPlaceholder('Username')");
  assert.match(e[0]?.evidence ?? "", /textbox Username/);
});

test("mergeEntries: dedups by locator (latest evidence wins), sorts, drops empties", () => {
  const merged = mergeEntries(
    [{ locator: "getByRole('link', { name: 'Logout' })", evidence: "old" }],
    [
      { locator: "getByRole('link', { name: 'Logout' })", evidence: "new evidence" }, // overwrites
      { locator: "getByPlaceholder('Password')", evidence: "textbox Password" },
      { locator: "  ", evidence: "blank dropped" },
    ],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((m) => m.locator.includes("Logout"))?.evidence, "new evidence");
  // sorted lexically by locator
  assert.deepEqual(merged.map((m) => m.locator).sort(), merged.map((m) => m.locator));
});

test("renderCacheHints: empty cache → '' (no block); non-empty → a prefer-these block with the locators", () => {
  assert.equal(renderCacheHints([], "x.com"), "");
  const block = renderCacheHints(
    [{ locator: "getByPlaceholder('Username')", evidence: "textbox Username" }],
    "www.saucedemo.com",
  );
  assert.match(block, /VERIFIED LOCATORS for www\.saucedemo\.com/);
  assert.match(block, /resolved UNIQUELY against the live DOM/);
  assert.match(block, /getByPlaceholder\('Username'\)/);
  assert.match(block, /reuse the locator verbatim/);
});
