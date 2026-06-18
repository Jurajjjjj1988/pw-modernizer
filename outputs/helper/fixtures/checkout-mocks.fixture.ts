// Migrated from cypress on 2026-06-18 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

// KB-1.1.27: all local type imports MUST use @type-defs/* — never @types/* (DefinitelyTyped collision → TS6137)
import { test as base, expect } from '@fixtures/base.fixture';
import type { CartApiResponse } from '@type-defs/external/cart-api';
import type { PaymentApiResponse } from '@type-defs/external/payment-api';

type MockFixtures = { checkoutMocks: void };

const cartMock: CartApiResponse = {
  items: [
    { id: 'item_001', name: 'Blue T-Shirt', quantity: 1, unitPrice: '$19.99' },
    { id: 'item_002', name: 'Black Jeans', quantity: 1, unitPrice: '$49.99' },
  ],
};

const paymentMock: PaymentApiResponse = { orderId: 'ord_test_001', status: 'confirmed' };

const test = base.extend<MockFixtures>({
  checkoutMocks: [
    async ({ page }, use) => {
      await page.route('**/api/cart', route =>
        route.fulfill({ status: 200, json: cartMock }),
      );
      await page.route('**/api/checkout/pay', route =>
        route.fulfill({ status: 201, json: paymentMock }),
      );
      await use();
    },
    { auto: true },
  ],
});

export { test, expect };
