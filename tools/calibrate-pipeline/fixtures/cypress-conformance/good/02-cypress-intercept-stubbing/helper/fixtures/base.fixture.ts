import { test as base, expect } from "@playwright/test";

import { PageClassCheckout } from "@page-object/pages/checkout.page";

/**
 * Per-migration extension of the qa-master base fixture. This file is the
 * ONLY one in the cypress-intercept-stubbing migration permitted to import
 * `test` from `@playwright/test`. The route stub for `/api/checkout/pay`
 * lives here (not in any spec): qa-master treats network mocks as fixtures
 * so the same stub is reused, every spec stays declarative, and the
 * "exactly-once" call assertion can read a fixture-owned counter.
 *
 * The cypress source used four overlapping `cy.intercept().as()` aliases
 * (`getCart`, `payReq`, `firstPay`, `firstFail`, `retrySuccess`) — most of
 * which the test never actually waited on. The migrated fixture collapses
 * the payment-endpoint stub to ONE `page.route` that returns a 201 with a
 * synthetic `orderId` and tracks how often it fired.
 */
interface MockPayApi {
  readonly callCount: number;
}

type Fixtures = {
  checkoutPage: PageClassCheckout;
  mockPayApi: MockPayApi;
};

const test = base.extend<Fixtures>({
  checkoutPage: async ({ page }, use) => use(new PageClassCheckout(page)),

  mockPayApi: async ({ page }, use) => {
    const state = { callCount: 0 };
    await page.route("**/api/checkout/pay", async (route) => {
      state.callCount += 1;
      await route.fulfill({
        status: 201,
        body: JSON.stringify({ orderId: "ord_calibration" }),
        headers: { "content-type": "application/json" },
      });
    });
    await use({
      get callCount() {
        return state.callCount;
      },
    });
  },
});

export { test, expect };
