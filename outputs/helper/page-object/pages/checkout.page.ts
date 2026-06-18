// Migrated from cypress on 2026-06-18 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { expect, type Locator } from '@playwright/test';
import { BasePage } from '@page-object/basepage';
import { LABEL_CHECKOUT } from '@test-data/labels';
import type { CheckoutCardData } from '@test-data/checkout';

const LABEL = LABEL_CHECKOUT;

export class PageClassCheckout extends BasePage {
  // Q7 unresolved: checkout navigation URL not confirmed; assumed /checkout from page name context
  readonly url = '/checkout';

  readonly headingCheckout: Locator = this.page
    .getByRole('heading', { name: /checkout/i })
    .describe(`[${LABEL}] Checkout page heading`);

  // Q8 unresolved: card input label text unknown and iframe nesting not confirmed
  // Fallback: if inside Stripe/Adyen iframe → page.frameLocator('iframe[title*="card" i]').getByRole('textbox', { name: /card number/i })
  readonly inputCard: Locator = this.page
    .getByLabel(/card number/i)
    .describe(`[${LABEL}] Card number input`);

  // Q8 unresolved: expiry input label text unknown; same iframe caveat as inputCard
  // Fallback: this.page.locator('input[name="exp"]')
  readonly inputExp: Locator = this.page
    .getByLabel(/expiry date|exp/i)
    .describe(`[${LABEL}] Card expiry input`);

  // Q8 unresolved: CVC input label text; same iframe caveat as inputCard
  readonly inputCvc: Locator = this.page
    .getByLabel(/cvc|cvv|security code/i)
    .describe(`[${LABEL}] Card CVC input`);

  readonly buttonPayNow: Locator = this.page
    .getByRole('button', { name: /pay now/i })
    .describe(`[${LABEL}] Pay now button`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.headingCheckout,
      `[${LABEL}] Checkout heading visible on page load`,
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
