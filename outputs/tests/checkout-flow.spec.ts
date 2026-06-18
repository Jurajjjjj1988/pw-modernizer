// Migrated from cypress on 2026-06-18 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { test, expect } from '@fixtures/checkout-mocks.fixture';

import { completeCheckout } from '@actions/complete-checkout';

import { TEST_CARD, MOCK_CART_ITEM_2_NAME, MOCK_CART_ITEM_COUNT } from '@test-data/checkout';

test.describe('Checkout flow', () => {
  // plan:scenario=1.1
  test(
    '[CHK-1] - Check that a credit-card payment completes the order',
    { tag: ['@positive', '@e2e'] },
    async ({ cartPage, checkoutPage, orderConfirmationPage }) => {
      await test.step('open the cart page', async () => {
        await cartPage.open();
      });

      await test.step('verify mock cart has the expected item count', async () => {
        await expect(cartPage.arrayCartRows, '[Cart] cart rows match mock count').toHaveCount(
          MOCK_CART_ITEM_COUNT,
        );
      });

      await test.step('update second cart item quantity to 3', async () => {
        await cartPage.updateItemQuantity(MOCK_CART_ITEM_2_NAME, '3');
      });

      await test.step('complete checkout with credit card payment', async () => {
        await completeCheckout({
          cartPage,
          checkoutPage,
          orderPage: orderConfirmationPage,
          card: TEST_CARD,
        });
      });

      await test.step('confirm URL redirected to order confirmation', async () => {
        await expect(orderConfirmationPage.page).toHaveURL(/\/order-confirmed/);
      });

      await test.step('confirm order confirmed heading is visible', async () => {
        await expect(
          orderConfirmationPage.headingOrderConfirmed,
          '[Order Confirmation] heading visible after payment',
        ).toBeVisible();
      });

      await test.step('confirm summary total shows currency symbol', async () => {
        await expect(
          orderConfirmationPage.textSummaryTotal,
          '[Order Confirmation] summary total contains dollar symbol',
        ).toContainText('$');
      });
    },
  );

  // plan:scenario=1.2
  test(
    '[CHK-2] - Check that the checkout CTA is disabled on an empty cart',
    { tag: ['@negative'] },
    async ({ cartPage }) => {
      await test.step('open the cart page', async () => {
        await cartPage.open();
      });

      await test.step('remove all cart items one by one', async () => {
        await cartPage.removeAllItems(MOCK_CART_ITEM_COUNT);
      });

      await test.step('confirm empty cart banner is visible', async () => {
        await expect(
          cartPage.textEmptyCartBanner,
          '[Cart] empty cart banner visible after all items removed',
        ).toBeVisible();
      });

      await test.step('confirm checkout button is disabled', async () => {
        // Q7 unresolved: if Checkout CTA is <a aria-disabled="true"> rather than <button disabled>,
        // replace toBeDisabled() with toHaveAttribute('aria-disabled', 'true')
        await expect(
          cartPage.buttonCheckout,
          '[Cart] Checkout button disabled on empty cart',
        ).toBeDisabled();
      });
    },
  );
});
