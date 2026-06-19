import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Cart";

/**
 * Shopping cart. Migrated from a Selenium Java test that used Thread.sleep
 * between add-to-cart steps; qa-master uses role-based locators and a
 * web-first badge assertion instead of any hard wait.
 */
export class PageClassCart extends BasePage {
  readonly url = "/inventory";

  readonly badgeCount = this.page
    .getByTestId("shopping-cart-badge")
    .describe(`[${LABEL}] Cart item-count badge`);

  readonly buttonAddBackpack = this.page
    .getByRole("button", { name: /add backpack to cart/i })
    .describe(`[${LABEL}] Add-backpack button`);

  async addBackpack(): Promise<void> {
    await this.buttonAddBackpack.click();
    await expect(
      this.badgeCount,
      `[${LABEL}] Cart badge should show one item after adding the backpack`,
    ).toHaveText("1");
  }
}
