import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Checkout";

/**
 * Cart + checkout surface. Migrated from `cypress-03-intercept-stubbing`:
 * the cypress source used deep CSS selectors (`.cart-row`, `input[name="card"]`,
 * `button.pay-now`) and ran `cy.wait('@payReq').then(interception => …)`
 * against an alias chain. The qa-master flow lifts every selector to
 * `getByRole` / `getByLabel` per the priority ladder, exposes one
 * `payWithCard()` action that wraps the form-fill + submit, and asserts on
 * the user-perceivable post-payment surface — the route stub itself is
 * declared in the fixture barrel (qa-master: route stubs are fixtures, not
 * inline spec setup), matching `expected-output.spec.ts` in the example
 * folder.
 */
export class PageClassCheckout extends BasePage {
  readonly url = "/cart";

  readonly arrayCartRows = this.page
    .getByRole("row")
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

  /**
   * Drive the checkout button, fill card details, submit. Asserts the URL
   * lands on `/order-confirmed` so the method never ends on `.click()`.
   */
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
