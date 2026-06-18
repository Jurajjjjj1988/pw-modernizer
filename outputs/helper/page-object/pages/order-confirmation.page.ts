// Migrated from cypress on 2026-06-18 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { expect, type Locator } from '@playwright/test';
import { BasePage } from '@page-object/basepage';
import { LABEL_ORDER } from '@test-data/labels';
import { URL_ORDER_CONFIRMED } from '@test-data/urls';

const LABEL = LABEL_ORDER;

export class PageClassOrderConfirmation extends BasePage {
  readonly url = URL_ORDER_CONFIRMED;

  // Q10b unresolved: order-confirmed element role assumed heading (<h1>–<h6>)
  // Fallback: this.page.getByText(/order confirmed/i)
  readonly headingOrderConfirmed: Locator = this.page
    .getByRole('heading', { name: /order confirmed/i })
    .describe(`[${LABEL}] Order confirmed heading`);

  // Q9 unresolved: summary-total testid absent, CSS fallback: this.page.locator('.summary-total')
  // Reviewer fallback: ask FE to add data-testid="summary-total", or confirm semantic role.
  readonly textSummaryTotal: Locator = this.page
    .getByTestId('summary-total')
    .describe(`[${LABEL}] Summary total amount`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.headingOrderConfirmed,
      `[${LABEL}] Order confirmed heading visible on page load`,
    ).toBeVisible();
  }
}
