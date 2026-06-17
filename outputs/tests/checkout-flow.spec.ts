// Migrated from cypress on 2026-06-17 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { test, expect } from "@fixtures/checkout-mocks.fixture";

import { completeCheckout } from "@actions/complete-checkout";

import { MOCK_CART_ITEM_2_NAME, MOCK_CART_ITEM_COUNT, TEST_CARD } from "@test-data/checkout";

test.describe("Checkout flow", () => {
  // plan:scenario=1.1
  test(
    "[CHK-1] - Check that a credit-card payment completes the order",
    {
      annotation: [{ type: "Test", description: "Happy-path: update qty → checkout → fill card → pay → confirm" }],
      tag: ["@positive", "@e2e"],
    },
    async ({ cartPage, checkoutPage, orderConfirmationPage, page }) => {
      await test.step("open the cart page", async () => {
        await cartPage.open();
      });

      await test.step("cart shows the mock-provided rows", async () => {
        await expect(
          cartPage.arrayCartRows,
          `[Cart] should have ${MOCK_CART_ITEM_COUNT} rows`,
        ).toHaveCount(MOCK_CART_ITEM_COUNT);
      });

      await test.step("update the second cart item quantity to 3", async () => {
        await cartPage.updateItemQuantity(MOCK_CART_ITEM_2_NAME, "3");
      });

      await test.step("complete the payment checkout flow", async () => {
        await completeCheckout({ cartPage, checkoutPage, orderPage: orderConfirmationPage, card: TEST_CARD });
      });

      await test.step("URL confirms the order-confirmation page was reached", async () => {
        await expect(page, `[Order Confirmation] URL should match /order-confirmed`).toHaveURL(
          /\/order-confirmed/,
        );
      });

      await test.step("order confirmed heading is visible", async () => {
        await expect(
          orderConfirmationPage.headingOrderConfirmed,
          `[Order Confirmation] heading visible`,
        ).toBeVisible();
      });

      await test.step("summary total shows a currency symbol", async () => {
        await expect(
          orderConfirmationPage.textSummaryTotal,
          `[Order Confirmation] total shows $`,
        ).toContainText("$");
      });
    },
  );

  // plan:scenario=1.2
  test(
    "[CHK-2] - Check that the checkout CTA is disabled on an empty cart",
    {
      annotation: [{ type: "Test", description: "Empty-cart: remove all items → banner visible → CTA disabled" }],
      tag: ["@negative"],
    },
    async ({ cartPage }) => {
      await test.step("open the cart page", async () => {
        await cartPage.open();
      });

      await test.step("remove all cart items one-by-one", async () => {
        await cartPage.removeAllItems(MOCK_CART_ITEM_COUNT);
      });

      await test.step("the empty-cart banner is visible", async () => {
        await expect(
          cartPage.textEmptyCartBanner,
          `[Cart] empty-cart banner visible after all items removed`,
        ).toBeVisible();
      });

      await test.step("the checkout CTA is disabled", async () => {
        await expect(
          cartPage.buttonCheckout,
          `[Cart] Checkout button should be disabled on empty cart`,
        ).toBeDisabled();
      });
    },
  );
});
