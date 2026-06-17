// Migrated from cypress on 2026-06-17 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

import type { CheckoutCardData } from "@test-data/checkout";
import { LABEL_CHECKOUT } from "@test-data/labels";

export class PageClassCheckout extends BasePage {
  readonly url = "/checkout";

  readonly headingCheckout: Locator = this.page
    .getByRole("heading", { name: /checkout/i })
    .describe(`[${LABEL_CHECKOUT}] Page heading`);

  // Q8 unresolved: card input label text and iframe nesting unknown — see outputs/plans/checkout-flow.cy.js.md pin 5
  readonly inputCard: Locator = this.page
    .getByLabel(/card number/i)
    .describe(`[${LABEL_CHECKOUT}] Card number input`);

  // Q8 unresolved: expiry input label text unknown — see pin 6
  readonly inputExp: Locator = this.page
    .getByLabel(/expiry date|exp/i)
    .describe(`[${LABEL_CHECKOUT}] Expiry date input`);

  readonly inputCvc: Locator = this.page
    .getByLabel(/cvc|cvv|security code/i)
    .describe(`[${LABEL_CHECKOUT}] CVC input`);

  readonly buttonPayNow: Locator = this.page
    .getByRole("button", { name: /pay now/i })
    .describe(`[${LABEL_CHECKOUT}] Pay Now button`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.page, `[${LABEL_CHECKOUT}] should be on the checkout page`).toHaveURL(/\/checkout/);
    await expect(
      this.headingCheckout,
      `[${LABEL_CHECKOUT}] heading should be visible`,
    ).toBeVisible();
  }

  async fillPaymentCard(card: CheckoutCardData): Promise<void> {
    await this.inputCard.fill(card.number);
    await this.inputExp.fill(card.expiry);
    await this.inputCvc.fill(card.cvc);
  }

  async submitPayment(): Promise<void> {
    await this.buttonPayNow.click();
  }
}
