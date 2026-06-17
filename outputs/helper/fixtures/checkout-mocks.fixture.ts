// Migrated from cypress on 2026-06-17 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { test as base, expect } from "@fixtures/base.fixture";

import type { CartApiResponse } from "@type-defs/external/cart-api";
import type { PaymentApiResponse } from "@type-defs/external/payment-api";
import { MOCK_CART_ITEM_1_NAME, MOCK_CART_ITEM_2_NAME } from "@test-data/checkout";

const MOCK_CART_RESPONSE: CartApiResponse = {
  items: [
    { id: "item_001", name: MOCK_CART_ITEM_1_NAME, quantity: 1, unitPrice: "$29.99" },
    { id: "item_002", name: MOCK_CART_ITEM_2_NAME, quantity: 1, unitPrice: "$89.99" },
  ],
};

const MOCK_PAYMENT_RESPONSE: PaymentApiResponse = {
  orderId: "ord_test_001",
  status: "confirmed",
};

type MockFixtures = { checkoutMocks: void };

const test = base.extend<MockFixtures>({
  checkoutMocks: [
    async ({ page }, use) => {
      await page.route("**/api/cart", async (route) => {
        await route.fulfill({ json: MOCK_CART_RESPONSE });
      });
      await page.route("**/api/checkout/pay", async (route) => {
        await route.fulfill({ status: 201, json: MOCK_PAYMENT_RESPONSE });
      });
      await use();
    },
    { auto: true },
  ],
});

export { test, expect };
