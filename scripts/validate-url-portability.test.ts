/**
 * validate-url-portability.test.ts — pins the domain-portability gate: absolute
 * navigation URLs (goto + Page url/path field) are flagged; relative URLs and
 * non-navigation absolute URLs (route patterns, assertions, comments) are not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { findAbsoluteUrls } from "./validate-url-portability.js";

test("flags an absolute page.goto", () => {
  const v = findAbsoluteUrls("await page.goto('https://www.saucedemo.com/inventory');");
  assert.equal(v.length, 1);
  assert.equal(v[0]?.kind, "goto");
  assert.equal(v[0]?.url, "https://www.saucedemo.com/inventory");
});

test("a relative goto is clean (the portable form)", () => {
  assert.deepEqual(findAbsoluteUrls("await page.goto('/inventory');"), []);
});

test("flags an absolute `url` class field (the Page's nav target)", () => {
  const src = "class P { readonly url = 'https://the-internet.herokuapp.com/login'; }";
  const v = findAbsoluteUrls(src);
  assert.equal(v.length, 1);
  assert.equal(v[0]?.kind, "url-field");
});

test("flags an absolute `path` field too", () => {
  const v = findAbsoluteUrls("class P { protected path = 'http://x.test/a'; }");
  assert.equal(v.length, 1);
  assert.equal(v[0]?.kind, "url-field");
});

test("a relative `url` field is clean", () => {
  assert.deepEqual(findAbsoluteUrls("class P { readonly url = '/login'; }"), []);
});

test("page.route with an absolute pattern is NOT flagged (mock may match an external host)", () => {
  assert.deepEqual(findAbsoluteUrls("await page.route('https://api.example.com/**', r => r.fulfill());"), []);
});

test("toHaveURL with an absolute URL is NOT flagged (assertion, not navigation)", () => {
  assert.deepEqual(findAbsoluteUrls("await expect(page).toHaveURL('https://x.test/done');"), []);
});

test("an absolute URL in a comment is NOT flagged", () => {
  assert.deepEqual(findAbsoluteUrls("// see https://the-internet.herokuapp.com\nawait page.goto('/login');"), []);
});

test("goto(this.url) — a non-literal — is clean (nothing to statically check)", () => {
  assert.deepEqual(findAbsoluteUrls("await this.page.goto(this.url);"), []);
});

test("reports both a bad goto and a bad url field in one file", () => {
  const src = [
    "class P {",
    "  readonly url = 'https://a.test/x';",
    "  async open() { await this.page.goto('https://a.test/y'); }",
    "}",
  ].join("\n");
  assert.equal(findAbsoluteUrls(src).length, 2);
});
