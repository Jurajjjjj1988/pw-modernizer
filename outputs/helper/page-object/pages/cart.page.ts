// Migrated from cypress on 2026-06-17 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

import { LABEL_CART } from "@test-data/labels";
import { URL_CART } from "@test-data/urls";

export class PageClassCart extends BasePage {
  readonly url = URL_CART;

  // Q4 unresolved: cart-row testid absent, CSS fallback — see outputs/plans/checkout-flow.cy.js.md pin 1
  readonly arrayCartRows: Locator = this.page
    .getByTestId("cart-row")
    .describe(`[${LABEL_CART}] Cart rows`);

  // Q6 unresolved: Update cart element role not confirmed — assumed <button> — see pin 3
  readonly buttonUpdateCart: Locator = this.page
    .getByRole("button", { name: /update cart/i })
    .describe(`[${LABEL_CART}] Update cart button`);

  // Q7 unresolved: Checkout CTA role and disabled mechanism not confirmed — assumed <button disabled> — see pin 4
  readonly buttonCheckout: Locator = this.page
    .getByRole("button", { name: /^checkout$/i })
    .describe(`[${LABEL_CART}] Checkout CTA`);

  // Q10 unresolved: empty-cart-banner ARIA role not confirmed — see pin 10
  readonly textEmptyCartBanner: Locator = this.page
    .getByRole("status")
    .describe(`[${LABEL_CART}] Empty cart banner`);

  // Q11 unresolved: remove button accessible name unknown — assumed visible text or aria-label 'Remove' — see pin 9
  readonly arrayRemoveButtons: Locator = this.page
    .getByRole("button", { name: /remove/i })
    .describe(`[${LABEL_CART}] All remove item buttons`);

  // Q4 unresolved: cart-row testid absent, CSS fallback — see pin 1
  // Q5 unresolved: qty input label unknown, fragile nth fallback if filter unavailable — see pin 2
  readonly byCartRowQtyInput = (productNameFilter: string): Locator =>
    this.arrayCartRows
      .filter({ hasText: productNameFilter })
      .getByRole("spinbutton")
      .describe(`[${LABEL_CART}] Quantity input for ${productNameFilter}`);

  // Q11 unresolved: remove button accessible name unknown — see pin 9
  readonly byRemoveButton = (productNameFilter: string): Locator =>
    this.arrayCartRows
      .filter({ hasText: productNameFilter })
      .getByRole("button", { name: /remove/i })
      .describe(`[${LABEL_CART}] Remove button for ${productNameFilter}`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.page, `[${LABEL_CART}] should be on the cart page`).toHaveURL(/\/cart/);
  }

  async updateItemQuantity(productNameFilter: string, qty: string): Promise<void> {
    await this.byCartRowQtyInput(productNameFilter).fill(qty);
    await this.buttonUpdateCart.click();
    // Q13: web-first guard confirming the async cart update committed before checkout navigation
    await expect(
      this.byCartRowQtyInput(productNameFilter),
      `[${LABEL_CART}] Quantity should reflect the update`,
    ).toHaveValue(qty);
  }

  async removeAllItems(count: number): Promise<void> {
    await expect(
      this.arrayRemoveButtons,
      `[${LABEL_CART}] should have ${count} remove buttons`,
    ).toHaveCount(count);
    for (let i = 0; i < count; i++) {
      // Re-acquire .first() each iteration — live locator shrinks as rows are removed
      await this.arrayRemoveButtons.first().click();
      await expect(
        this.arrayRemoveButtons,
        `[${LABEL_CART}] remove button count should decrease after each removal`,
      ).toHaveCount(count - i - 1);
    }
  }

  async clickCheckout(): Promise<void> {
    await this.buttonCheckout.click();
  }
}
