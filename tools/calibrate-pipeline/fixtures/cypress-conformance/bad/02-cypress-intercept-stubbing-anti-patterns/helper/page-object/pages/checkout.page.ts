import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Checkout";

/**
 * BAD version. Same scenario as good/02 but seeded with anti-pattern #4:
 * the cart-row locator is a raw `this.page.locator('.cart-row')` CSS class
 * — the cypress `cy.get('.cart-row')` selector was migrated verbatim
 * instead of being lifted to `getByRole('row')` per pwm-blueprint selector
 * priority. The conformance validator's W5 (locator-priority) must flag
 * this row.
 */
export class PageClassCheckout extends BasePage {
  readonly url = "/cart";

  // Anti-pattern #4 — raw CSS class survives from the cypress source.
  readonly arrayCartRows = this.page
    .locator(".cart-row")
    .describe(`[${LABEL}] Cart line-item rows`);

  readonly buttonCheckout = this.page
    .getByRole("button", { name: "Checkout" })
    .describe(`[${LABEL}] Checkout button`);

  readonly inputCardNumber = this.page
    .getByLabel("Card number")
    .describe(`[${LABEL}] Card number field`);

  readonly inputExpiry = this.page
    .getByLabel("Expiration")
    .describe(`[${LABEL}] Expiration field`);

  readonly inputCvc = this.page
    .getByLabel("CVC")
    .describe(`[${LABEL}] CVC field`);

  readonly buttonPayNow = this.page
    .getByRole("button", { name: /pay/i })
    .describe(`[${LABEL}] Pay now button`);

  readonly textOrderConfirmed = this.page
    .getByText("Order confirmed")
    .describe(`[${LABEL}] Order confirmation surface`);

  async open(): Promise<void> {
    await this.page.goto(this.url, { timeout: 60_000 });
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.arrayCartRows.first(),
      `[${LABEL}] First cart row should be visible after navigation`,
    ).toBeVisible({ timeout: 30_000 });
  }

  async payWithCard(card: {
    number: string;
    expiry: string;
    cvc: string;
  }): Promise<void> {
    await this.buttonCheckout.click();
    await this.inputCardNumber.fill(card.number);
    await this.inputExpiry.fill(card.expiry);
    await this.inputCvc.fill(card.cvc);
    await this.buttonPayNow.click();
    await expect(
      this.page,
      `[${LABEL}] Successful payment should navigate to /order-confirmed`,
    ).toHaveURL(/\/order-confirmed/);
  }
}
