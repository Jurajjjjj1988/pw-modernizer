// Migrated from cypress on 2026-06-17 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import type { PageClassCart } from "@page-object/pages/cart.page";
import type { PageClassCheckout } from "@page-object/pages/checkout.page";
import type { PageClassOrderConfirmation } from "@page-object/pages/order-confirmation.page";

import type { CheckoutCardData } from "@test-data/checkout";

export async function completeCheckout(params: {
  cartPage: PageClassCart;
  checkoutPage: PageClassCheckout;
  orderPage: PageClassOrderConfirmation;
  card: CheckoutCardData;
}): Promise<void> {
  const { cartPage, checkoutPage, orderPage, card } = params;
  await cartPage.clickCheckout();
  await checkoutPage.waitForPageLoad();
  await checkoutPage.fillPaymentCard(card);
  await checkoutPage.submitPayment();
  await orderPage.waitForPageLoad();
}
