// Migrated from bad-playwright on 2026-06-17 by Migrator.
// See outputs/plans/missing-await.spec.ts.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";
import { BasePage } from "@page-object/basepage";
import { LABEL_CART } from "@test-data/labels";

const LABEL = LABEL_CART;

export class PageClassCart extends BasePage {
  readonly url = "/cart";

  // TODO: Q1 unresolved: cart-subtotal testid not confirmed — CSS class locator kept as fallback
  readonly textSubtotal: Locator = this.page
    .getByTestId("cart-subtotal")
    .describe(`[${LABEL}] Cart subtotal`);

  // TODO: Q2 unresolved: qty-input accessible label not confirmed — CSS class locator kept as fallback
  readonly inputQty: Locator = this.page
    .getByLabel(/quantity/i)
    .describe(`[${LABEL}] Quantity input`);

  readonly buttonUpdate: Locator = this.page
    .getByRole("button", { name: "Update" })
    .describe(`[${LABEL}] Update cart button`);

  readonly textEmptyCart: Locator = this.page
    .getByText(/your cart is empty/i)
    .describe(`[${LABEL}] Empty cart message`);

  readonly buttonAdd = (name: string): Locator =>
    this.page
      .getByRole("button", { name })
      .describe(`[${LABEL}] Add to cart: ${name}`);

  // TODO: Q3 unresolved: stable page-readiness landmark not confirmed — using empty-cart
  // text as guard; valid for fresh browser contexts where the cart starts empty.
  async waitForPageLoad(): Promise<void> {
    await expect(
      this.textEmptyCart,
      `[${LABEL}] empty cart message visible on initial load`
    ).toBeVisible();
  }

  async addItem(name: string): Promise<void> {
    await this.buttonAdd(name).click();
    // Web-first guard replaces the 800ms waitForTimeout calls from the source.
    await expect(
      this.textSubtotal,
      `[${LABEL}] subtotal visible after adding ${name}`
    ).toBeVisible();
  }

  async expectSubtotalToHaveText(text: string): Promise<void> {
    // TODO: Q4 unresolved: exact format of subtotal string not confirmed — '$148' may differ
    // by locale (e.g. '$148.00'). Switch to toHaveText(/\$148/) if formatting varies.
    await expect(
      this.textSubtotal,
      `[${LABEL}] subtotal displays expected value`
    ).toHaveText(text);
  }

  async setQuantityToZero(): Promise<void> {
    await this.inputQty.fill("0");
  }

  async clickUpdate(): Promise<void> {
    await this.buttonUpdate.click();
    await expect(
      this.page,
      `[${LABEL}] remains on cart page after update`
    ).toHaveURL(/\/cart/);
  }

  async expectEmptyCartVisible(): Promise<void> {
    await expect(
      this.textEmptyCart,
      `[${LABEL}] empty cart message visible after clearing cart`
    ).toBeVisible();
  }
}
