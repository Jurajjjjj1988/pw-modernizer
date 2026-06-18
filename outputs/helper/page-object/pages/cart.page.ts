// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/missing-await.spec.ts.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { LABEL_CART } from "@test-data/labels";

export class PageClassCart extends BasePage {
  readonly url = "/cart";

  readonly byAddItemButton = (name: string): Locator =>
    this.page
      .getByRole("button", { name })
      .describe(`[${LABEL_CART}] Add item button: ${name}`);

  readonly buttonUpdate: Locator = this.page
    .getByRole("button", { name: "Update" })
    .describe(`[${LABEL_CART}] Update quantity button`);

  // TODO: Q1 unresolved — cart-subtotal testid not confirmed — CSS class locator kept as fallback
  readonly textSubtotal: Locator = this.page
    .getByTestId("cart-subtotal")
    .describe(`[${LABEL_CART}] Cart subtotal`);

  // TODO: Q2 unresolved — qty-input accessible label not confirmed — CSS class locator kept as fallback
  readonly inputQuantity: Locator = this.page
    .getByLabel(/quantity/i)
    .describe(`[${LABEL_CART}] Quantity input`);

  readonly textEmptyCart: Locator = this.page
    .getByText(/your cart is empty/i)
    .describe(`[${LABEL_CART}] Empty cart message`);

  async waitForPageLoad(): Promise<void> {
    // TODO: Q3 unresolved — provisional URL guard; add stable heading/landmark testid when DOM snapshot available
    await expect(this.page, `[${LABEL_CART}] Cart page URL`).toHaveURL(/\/cart/);
  }

  async clickAddItem(name: string): Promise<void> {
    await this.byAddItemButton(name).click();
  }

  async fillQuantity(value: string): Promise<void> {
    await this.inputQuantity.fill(value);
  }

  async clickUpdate(): Promise<void> {
    await this.buttonUpdate.click();
  }

  async expectSubtotalText(expected: string): Promise<void> {
    await expect(
      this.textSubtotal,
      `[${LABEL_CART}] Subtotal shows expected price`
    ).toHaveText(expected);
  }

  async expectEmptyCartVisible(): Promise<void> {
    await expect(
      this.textEmptyCart,
      `[${LABEL_CART}] Empty cart message visible`
    ).toBeVisible();
  }
}
