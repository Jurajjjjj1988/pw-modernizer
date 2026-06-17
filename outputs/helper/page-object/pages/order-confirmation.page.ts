// Migrated from cypress on 2026-06-17 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

import { LABEL_ORDER } from "@test-data/labels";

export class PageClassOrderConfirmation extends BasePage {
  readonly url = "/order-confirmed";

  // Q10b unresolved: order-confirmed element role assumed heading (<h1>–<h6>) — see outputs/plans/checkout-flow.cy.js.md pin 8
  readonly headingOrderConfirmed: Locator = this.page
    .getByRole("heading", { name: /order confirmed/i })
    .describe(`[${LABEL_ORDER}] Order confirmed heading`);

  // Q9 unresolved: summary-total testid absent, CSS fallback — see pin 7
  readonly textSummaryTotal: Locator = this.page
    .getByTestId("summary-total")
    .describe(`[${LABEL_ORDER}] Summary total`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.page,
      `[${LABEL_ORDER}] should be on the order-confirmation page`,
    ).toHaveURL(/\/order-confirmed/);
    await expect(
      this.headingOrderConfirmed,
      `[${LABEL_ORDER}] order confirmed heading should be visible`,
    ).toBeVisible();
  }
}
