#!/usr/bin/env tsx
/**
 * Unit coverage for the network-completeness validator's pure core. The corpus
 * mirrors the confirmed false-green: a Cypress source stubs + asserts a network
 * call, and both mainstream codemods (cy2pw, 11joselu) drop the stub body, so the
 * migrated test passes against the real backend for the wrong reason. These tests
 * pin the SOURCE-vs-OUTPUT presence diff — extract the source intercepts, then
 * confirm a clean reflection passes while each drop class flags.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractSourceIntercepts,
  findMissingMocks,
  networkVerdict,
} from "./validate-network-completeness.js";

const INTERCEPT_SOURCE = `
  beforeEach(() => {
    cy.intercept('GET', '/api/cart').as('getCart');
    cy.intercept('POST', '/api/checkout/pay').as('payReq');
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

test("extractSourceIntercepts: finds method+url, alias, and which one is asserted-on", () => {
  const intercepts = extractSourceIntercepts(INTERCEPT_SOURCE);
  assert.equal(intercepts.length, 2);
  const cart = intercepts.find((i) => i.url === "/api/cart");
  const pay = intercepts.find((i) => i.url === "/api/checkout/pay");
  // both are aliased
  assert.equal(cart?.aliased, true);
  assert.equal(pay?.aliased, true);
  // getCart is only waited (no chain) → not asserted-on; payReq has a .then() → asserted-on
  assert.equal(cart?.assertedOn, false);
  assert.equal(pay?.assertedOn, true);
});

test("findMissingMocks: a fulfilled page.route reflecting the stub → clean", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('GET', '/api/cart').as('getCart'); cy.wait('@getCart');");
  const output = `
    await page.route("**/api/cart", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CART_MOCK) });
    });
  `;
  assert.deepEqual(findMissingMocks(intercepts, output), []);
});

test("findMissingMocks: a dropped stub (no page.route) is flagged", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('GET', '/api/cart').as('getCart');");
  // The codemod dropped the stub entirely — output navigates but never routes.
  const output = `await page.goto("/cart"); await expect(page.getByText("Cart")).toBeVisible();`;
  const missing = findMissingMocks(intercepts, output);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.url, "/api/cart");
  assert.match(missing[0]?.reason ?? "", /no page\.route\(\) for it/);
});

test("findMissingMocks: a page.route with an EMPTY fulfill body is flagged (truncation)", () => {
  const intercepts = extractSourceIntercepts("cy.intercept('POST', '/api/checkout/pay').as('pay');");
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
    "cy.intercept('POST', '/api/checkout/pay').as('pay'); cy.wait('@pay').then((i) => { expect(i.response.statusCode).to.equal(201); });",
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
    "cy.intercept('POST', '/api/checkout/pay').as('pay'); cy.wait('@pay').its('response.statusCode').should('eq', 201);",
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

test("networkVerdict: a source with no cy.intercept passes trivially", () => {
  const v = networkVerdict("it('logs in', () => { cy.visit('/login'); cy.get('#user').type('a'); });", "await page.goto('/login');");
  assert.equal(v.hasIntercepts, false);
  assert.equal(v.complete, true);
  assert.match(v.reason, /no cy\.intercept/);
});

test("networkVerdict: the full false-green corpus — two stubs both dropped → incomplete", () => {
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
