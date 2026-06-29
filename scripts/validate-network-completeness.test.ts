#!/usr/bin/env tsx
/**
 * Unit coverage for the network-completeness validator's pure core. The corpus
 * mirrors the confirmed false-green: a Cypress source stubs + asserts a network
 * call, and both mainstream codemods (cy2pw, 11joselu) drop the stub body, so the
 * migrated test passes against the real backend for the wrong reason. These tests
 * pin the SOURCE-vs-OUTPUT presence diff — extract the source intercepts, then
 * confirm a clean reflection passes while each drop class flags.
 *
 * The intercept corpus distinguishes a STUB (`cy.intercept` carrying a response
 * body / `{fixture}` / `req.reply`) from a SPY (a 2-arg passthrough that only
 * observes the real call). A STUB must be reflected by a fulfilled `page.route`; a
 * SPY by a `page.waitForResponse(...)` sync point — demanding a fabricated route
 * for a spy would invent a mock the source never had.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

import {
  extractSourceIntercepts,
  findMissingMocks,
  networkVerdict,
  collectFixtureAndActionFiles,
} from "./validate-network-completeness.js";

// Two STUB intercepts (each supplies a response body) that the codemod drops —
// the documented false-green: the migrated test then runs against the real
// backend because the stub that pinned the response is gone.
const INTERCEPT_SOURCE = `
  beforeEach(() => {
    cy.intercept('GET', '/api/cart', { statusCode: 200, body: { items: [] } }).as('getCart');
    cy.intercept('POST', '/api/checkout/pay', { statusCode: 201, body: { orderId: 'ord_1' } }).as('payReq');
    cy.visit('/cart');
    cy.wait('@getCart');
  });
  it('checks out', () => {
    cy.get('button.pay-now').click();
    cy.wait('@payReq').then((interception) => {
      expect(interception.response.statusCode).to.equal(201);
    });
  });
`;

test("extractSourceIntercepts: finds method+url, alias, asserted-on, and stub vs spy", () => {
  const intercepts = extractSourceIntercepts(INTERCEPT_SOURCE);
  assert.equal(intercepts.length, 2);
  const cart = intercepts.find((i) => i.url === "/api/cart");
  const pay = intercepts.find((i) => i.url === "/api/checkout/pay");
  // both are aliased
  assert.equal(cart?.aliased, true);
  assert.equal(pay?.aliased, true);
  // both carry a response object literal → STUB
  assert.equal(cart?.hasStub, true);
  assert.equal(pay?.hasStub, true);
  // getCart is only waited (no chain) → not asserted-on; payReq has a .then() → asserted-on
  assert.equal(cart?.assertedOn, false);
  assert.equal(pay?.assertedOn, true);
});

test("extractSourceIntercepts: a 2-arg cy.intercept(method,url) is a SPY (hasStub=false)", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('GET', '/api/cart').as('getCart'); cy.wait('@getCart');");
  assert.equal(intercepts.length, 1);
  assert.equal(intercepts[0]?.hasStub, false);
  assert.equal(intercepts[0]?.aliased, true);
});

test("extractSourceIntercepts: a {fixture} body and a req.reply handler are both STUBs", () => {
  const fixtureForm = extractSourceIntercepts("cy.intercept('GET', '/api/products', { fixture: 'products.json' }).as('prods');");
  assert.equal(fixtureForm[0]?.hasStub, true);
  const replyForm = extractSourceIntercepts(
    "cy.intercept('POST', '/api/login', (req) => { req.reply({ statusCode: 200, body: { token: 't' } }); }).as('login');",
  );
  assert.equal(replyForm[0]?.hasStub, true);
});

test("extractSourceIntercepts: a stub body containing parens (JSON.stringify) is still a STUB and the url survives", () => {
  const intercepts = extractSourceIntercepts(
    "cy.intercept('GET', '/api/cart', { statusCode: 200, body: JSON.stringify({ items: [1, 2] }) }).as('cart');",
  );
  assert.equal(intercepts.length, 1);
  assert.equal(intercepts[0]?.url, "/api/cart");
  assert.equal(intercepts[0]?.hasStub, true);
});

test("findMissingMocks: a STUB reflected by a fulfilled page.route → clean", () => {
  const intercepts = extractSourceIntercepts(
    "cy.intercept('GET', '/api/cart', { statusCode: 200, body: { items: [] } }).as('getCart'); cy.wait('@getCart');",
  );
  const output = `
    await page.route("**/api/cart", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CART_MOCK) });
    });
  `;
  assert.deepEqual(findMissingMocks(intercepts, output), []);
});

test("findMissingMocks: a dropped STUB (no page.route) is flagged on the route axis", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('GET', '/api/cart', { statusCode: 200, body: { items: [] } }).as('getCart');");
  // The codemod dropped the stub entirely — output navigates but never routes.
  const output = `await page.goto("/cart"); await expect(page.getByText("Cart")).toBeVisible();`;
  const missing = findMissingMocks(intercepts, output);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.url, "/api/cart");
  assert.match(missing[0]?.reason ?? "", /no page\.route\(\) for it/);
});

test("findMissingMocks: a SPY (2-arg) waited-on but with NO waitForResponse sync point is flagged", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('GET', '/api/cart').as('getCart'); cy.wait('@getCart');");
  assert.equal(intercepts[0]?.hasStub, false);
  // The migrated tree only navigates — the spy's wait was dropped. Demanding a
  // fulfilled route here would fabricate a mock; the right miss is the lost sync.
  const output = `await page.goto("/cart"); await expect(page.getByText("Cart")).toBeVisible();`;
  const missing = findMissingMocks(intercepts, output);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.url, "/api/cart");
  assert.match(missing[0]?.reason ?? "", /no page\.waitForResponse\(\.\.\.\) sync point/);
});

test("findMissingMocks: an UNALIASED spy (never waited) is NOT flagged — nothing to preserve", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('GET', '/api/telemetry');");
  assert.equal(intercepts[0]?.hasStub, false);
  assert.equal(intercepts[0]?.aliased, false);
  // Output never routes or waits on it — but the source never consumed it either,
  // so demanding a sync point would be a false positive.
  const output = `await page.goto("/dashboard"); await expect(page.getByTestId("panel")).toBeVisible();`;
  assert.deepEqual(findMissingMocks(intercepts, output), []);
});

test("findMissingMocks: a SPY reflected by a page.waitForResponse sync point → clean (no route demanded)", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('GET', '/api/cart').as('getCart'); cy.wait('@getCart');");
  assert.equal(intercepts[0]?.hasStub, false);
  const output = `
    const cartResponse = page.waitForResponse("**/api/cart");
    await page.goto("/cart");
    await cartResponse;
  `;
  assert.deepEqual(findMissingMocks(intercepts, output), []);
});

test("findMissingMocks: a STUB page.route with an EMPTY fulfill body is flagged (truncation)", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('POST', '/api/checkout/pay', { statusCode: 201, body: {} }).as('pay');");
  const output = `
    await page.route("**/api/checkout/pay", async (route) => {
      await route.fulfill({});
    });
  `;
  const missing = findMissingMocks(intercepts, output);
  assert.equal(missing.length, 1);
  assert.match(missing[0]?.reason ?? "", /no non-empty route\.fulfill/);
});

test("findMissingMocks: a dropped response-assertion is flagged when the source asserted on it", () => {
  const intercepts = extractSourceIntercepts(
    "cy.intercept('POST', '/api/checkout/pay', { statusCode: 201, body: { orderId: 'ord_1' } }).as('pay'); cy.wait('@pay').then((i) => { expect(i.response.statusCode).to.equal(201); });",
  );
  assert.equal(intercepts[0]?.assertedOn, true);
  // The stub is reflected and fulfilled, but NO page.waitForResponse reads the response.
  const output = `
    await page.route("**/api/checkout/pay", async (route) => {
      await route.fulfill({ status: 201, body: JSON.stringify({ orderId: "ord_1" }) });
    });
    await page.getByRole("button", { name: "Pay" }).click();
    await expect(page).toHaveURL(/order-confirmed/);
  `;
  const missing = findMissingMocks(intercepts, output);
  assert.equal(missing.length, 1);
  assert.match(missing[0]?.reason ?? "", /response assertion was dropped/);
});

test("findMissingMocks: an asserted-on response REFLECTED by a waitForResponse reading status() → clean", () => {
  const intercepts = extractSourceIntercepts(
    "cy.intercept('POST', '/api/checkout/pay', { statusCode: 201, body: { orderId: 'ord_1' } }).as('pay'); cy.wait('@pay').its('response.statusCode').should('eq', 201);",
  );
  assert.equal(intercepts[0]?.assertedOn, true);
  const output = `
    await page.route("**/api/checkout/pay", async (route) => {
      await route.fulfill({ status: 201, body: JSON.stringify({ orderId: "ord_1" }) });
    });
    const response = await page.waitForResponse("**/api/checkout/pay");
    expect(response.status()).toBe(201);
  `;
  assert.deepEqual(findMissingMocks(intercepts, output), []);
});

test("extractSourceIntercepts: an alias YIELD (cy.get('@alias').its('response...')) counts as asserted-on", () => {
  // The interception alias is yielded via cy.get (not cy.wait) and its response read.
  const intercepts = extractSourceIntercepts(
    "cy.intercept('POST', '/api/checkout/pay', { statusCode: 201, body: {} }).as('pay'); cy.wait('@pay'); cy.get('@pay').its('response.statusCode').should('eq', 201);",
  );
  assert.equal(intercepts[0]?.assertedOn, true);
});

test("findMissingMocks: an alias-YIELD response-assertion is flagged when the read is dropped", () => {
  const intercepts = extractSourceIntercepts(
    "cy.intercept('POST', '/api/checkout/pay', { statusCode: 201, body: {} }).as('pay'); cy.get('@pay').then((i) => { expect(i.response.statusCode).to.equal(201); });",
  );
  assert.equal(intercepts[0]?.assertedOn, true);
  // Route reflected, but no waitForResponse reads the response.
  const output = `
    await page.route("**/api/checkout/pay", async (route) => {
      await route.fulfill({ status: 201, body: JSON.stringify({ ok: true }) });
    });
  `;
  const missing = findMissingMocks(intercepts, output);
  assert.equal(missing.length, 1);
  assert.match(missing[0]?.reason ?? "", /response assertion was dropped/);
});

test("collectFixtureAndActionFiles: scans helper/fixtures + helper/actions for .ts, recursively", () => {
  const helperRoot = mkdtempSync(join(tmpdir(), "pwm-netcomp-"));
  try {
    mkdirSync(join(helperRoot, "fixtures"), { recursive: true });
    mkdirSync(join(helperRoot, "actions", "nested"), { recursive: true });
    mkdirSync(join(helperRoot, "page-object"), { recursive: true });
    writeFileSync(join(helperRoot, "fixtures", "products-mocks.fixture.ts"), "// route stub lives here");
    writeFileSync(join(helperRoot, "fixtures", "README.md"), "not a ts file");
    writeFileSync(join(helperRoot, "actions", "nested", "checkout.action.ts"), "// nested action");
    // A file outside fixtures/ and actions/ must NOT be picked up by this scan.
    writeFileSync(join(helperRoot, "page-object", "cart.page.ts"), "// page object");

    const found = collectFixtureAndActionFiles(helperRoot).map((f) => basename(f)).sort((a, b) => a.localeCompare(b));
    assert.deepEqual(found, ["checkout.action.ts", "products-mocks.fixture.ts"]);
  } finally {
    rmSync(helperRoot, { recursive: true, force: true });
  }
});

test("collectFixtureAndActionFiles: a missing helper root yields no files (no throw)", () => {
  assert.deepEqual(collectFixtureAndActionFiles(join(tmpdir(), "pwm-netcomp-does-not-exist-xyz")), []);
});

test("findMissingMocks: a STUB reflected ONLY inside a mock-fixture file's page.route → clean", () => {
  // The route stub is parked in products-mocks.fixture.ts (not the spec). Once the
  // fixture-scan folds that file into outputSource, the stub is seen → no drop.
  const intercepts = extractSourceIntercepts(
    "cy.intercept('GET', '/api/products', { fixture: 'products.json' }).as('prods');",
  );
  const fixtureFileSource = `
    export const productsMocks = base.extend({
      mockProducts: [async ({ page }, use) => {
        await page.route("**/api/products", async (route) => {
          await route.fulfill({ status: 200, body: JSON.stringify(PRODUCTS) });
        });
        await use();
      }, { auto: true }],
    });
  `;
  const specSource = `await page.goto("/products"); await expect(page.getByTestId("grid")).toBeVisible();`;
  // Simulating main()'s union: spec + mock fixture concatenated.
  assert.deepEqual(findMissingMocks(intercepts, `${specSource}\n${fixtureFileSource}`), []);
});

test("networkVerdict: a source with no cy.intercept passes trivially", () => {
  const v = networkVerdict("it('logs in', () => { cy.visit('/login'); cy.get('#user').type('a'); });", "await page.goto('/login');");
  assert.equal(v.hasIntercepts, false);
  assert.equal(v.complete, true);
  assert.match(v.reason, /no cy\.intercept/);
});

test("networkVerdict: the full false-green corpus — two STUBs both dropped → incomplete", () => {
  // Both intercepts dropped by the codemod; the migrated tree only navigates.
  const output = `await page.goto("/cart"); await page.getByRole("button", { name: "Pay" }).click();`;
  const v = networkVerdict(INTERCEPT_SOURCE, output);
  assert.equal(v.hasIntercepts, true);
  assert.equal(v.complete, false);
  // getCart (stub dropped) + payReq (stub dropped) — the asserted-on payReq is
  // already caught by its absent route, so at least the 2 missing routes surface.
  assert.ok(v.missing.length >= 2, `expected >=2 missing, got ${v.missing.length}`);
  assert.ok(v.missing.some((m) => m.url === "/api/cart"));
  assert.ok(v.missing.some((m) => m.url === "/api/checkout/pay"));
});
