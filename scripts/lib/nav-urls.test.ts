#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveNavUrls, buildSnapshotFlow } from "./nav-urls.js";

test("absolute cy.visit URL is taken as-is", () => {
  assert.deepEqual(deriveNavUrls("cy.visit('https://the-internet.herokuapp.com/login')", "https://x"),
    ["https://the-internet.herokuapp.com/login"]);
});
test("relative paths resolve against the base URL across frameworks", () => {
  const src = "cy.visit('/login'); await page.goto('/cart'); driver.get('/inventory')";
  assert.deepEqual(deriveNavUrls(src, "https://www.saucedemo.com"),
    ["https://www.saucedemo.com/login","https://www.saucedemo.com/cart","https://www.saucedemo.com/inventory"]);
});
test("templated URLs are skipped; duplicates collapse", () => {
  const src = "cy.visit(`${base}/x`); cy.visit('/a'); cy.visit('/a')";
  assert.deepEqual(deriveNavUrls(src, "https://x.com"), ["https://x.com/a"]);
});
test("buildSnapshotFlow makes one goto+snap per page; empty → ''", () => {
  assert.equal(buildSnapshotFlow(["https://x/a","https://x/b"]), "goto https://x/a; snap page1; goto https://x/b; snap page2");
  assert.equal(buildSnapshotFlow([]), "");
});
