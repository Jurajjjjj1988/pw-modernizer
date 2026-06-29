import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Cart";

/**
 * Cart page used by the good (b) fixture. Fully pwm-blueprint conformant: no own
 * constructor, every locator is a `.describe()`-labelled readonly field, the
 * load gate keys off the URL (structural invariant), and no method ends on a
 * bare click(). Nothing here trips W1/W2/W5/W15 or any block check.
 */
export class PageClassCart extends BasePage {
  readonly url = "/cart";

  readonly buttonAddFirst = this.page
    .getByRole("button", { name: /add to cart/i })
    .first()
    .describe(`[${LABEL}] Add-to-cart button`);

  readonly textBadgeCount = this.page
    .getByTestId("cart-badge")
    .describe(`[${LABEL}] Cart badge count`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.page, `[${LABEL}] cart URL`).toHaveURL(/\/cart/);
  }

  async addFirstItem(): Promise<void> {
    await this.buttonAddFirst.click();
    await expect(this.textBadgeCount, `[${LABEL}] badge appears after add`).toBeVisible();
  }
}
