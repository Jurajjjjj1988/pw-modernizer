// Migrated from cypress on 2026-06-18 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

export type CheckoutCardData = { number: string; expiry: string; cvc: string };

export const TEST_CARD_NUMBER = '4242 4242 4242 4242';
export const TEST_CARD_EXPIRY = '12/30';
export const TEST_CARD_CVC = '123';

export const TEST_CARD: CheckoutCardData = {
  number: TEST_CARD_NUMBER,
  expiry: TEST_CARD_EXPIRY,
  cvc: TEST_CARD_CVC,
};

// These mirror the items injected by checkout-mocks.fixture.ts — keep the names in sync if the mock changes.
export const MOCK_CART_ITEM_2_NAME = 'Black Jeans';
export const MOCK_CART_ITEM_COUNT = 2;
