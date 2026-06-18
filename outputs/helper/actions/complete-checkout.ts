// Migrated from cypress on 2026-06-18 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import type { PageClassCart } from '@page-object/pages/cart.page';
import type { PageClassCheckout } from '@page-object/pages/checkout.page';
import type { PageClassOrderConfirmation } from '@page-object/pages/order-confirmation.page';
import type { CheckoutCardData } from '@test-data/checkout';

type CompleteCheckoutParams = {
  cartPage: PageClassCart;
  checkoutPage: PageClassCheckout;
  orderPage: PageClassOrderConfirmation;
  card: CheckoutCardData;
};

export async function completeCheckout({
  cartPage,
  checkoutPage,
  orderPage,
  card,
}: CompleteCheckoutParams): Promise<void> {
  await cartPage.clickCheckout();
  await checkoutPage.waitForPageLoad();
  await checkoutPage.fillPaymentCard(card);
  await checkoutPage.submitPayment();
  await orderPage.waitForPageLoad();
}
