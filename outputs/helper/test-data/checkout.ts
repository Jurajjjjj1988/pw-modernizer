// Migrated from cypress on 2026-06-17 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

export const TEST_CARD_NUMBER = "4242 4242 4242 4242";
export const TEST_CARD_EXPIRY = "12/30";
export const TEST_CARD_CVC = "123";

export type CheckoutCardData = {
  number: string;
  expiry: string;
  cvc: string;
};

export const TEST_CARD: CheckoutCardData = {
  number: TEST_CARD_NUMBER,
  expiry: TEST_CARD_EXPIRY,
  cvc: TEST_CARD_CVC,
};

export const MOCK_CART_ITEM_COUNT = 2;
export const MOCK_CART_ITEM_1_NAME = "Classic White Tee";
export const MOCK_CART_ITEM_2_NAME = "Blue Denim Jacket";
