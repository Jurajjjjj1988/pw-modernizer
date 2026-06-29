import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Cart";

/**
 * Bad fixture — same cart scenario as good/03 but seeded with a single
 * block-severity violation in the addBackpack method: the assertion omits its
 * `[LABEL] WHY` message argument, which KB
 * pwm-blueprint/architecture/expect-no-label forbids. (Comments here avoid the
 * literal assertion token so only the seeded line trips the rule.)
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
    await expect(this.badgeCount).toHaveText("1");
  }
}
