// Migrated from cypress on 2026-06-18 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

import { expect, type Locator } from '@playwright/test';
import { BasePage } from '@page-object/basepage';
import { LABEL_CART } from '@test-data/labels';
import { URL_CART } from '@test-data/urls';

const LABEL = LABEL_CART;

export class PageClassCart extends BasePage {
  readonly url = URL_CART;

  // Q4 unresolved: cart-row testid absent, CSS fallback: this.page.locator('.cart-row')
  // Reviewer fallback: ask FE to add data-testid="cart-row", or confirm row semantic role (e.g. role="row").
  readonly arrayCartRows: Locator = this.page
    .getByTestId('cart-row')
    .describe(`[${LABEL}] Cart item rows`);

  // Q6 unresolved: Update cart element role not confirmed — assumed <button>
  // Fallback: this.page.getByRole('link', { name: /update cart/i })
  readonly buttonUpdateCart: Locator = this.page
    .getByRole('button', { name: /update cart/i })
    .describe(`[${LABEL}] Update cart button`);

  // Q7 unresolved: Checkout CTA role and disabled mechanism not confirmed — assumed <button disabled>
  // Fallback: this.page.getByRole('link', { name: /^checkout$/i }) with toHaveAttribute('aria-disabled','true')
  readonly buttonCheckout: Locator = this.page
    .getByRole('button', { name: /^checkout$/i })
    .describe(`[${LABEL}] Checkout button`);

  // Q10 unresolved: empty-cart-banner ARIA role not confirmed — assumed role="status"
  // Fallback: this.page.locator('.empty-cart-banner')
  readonly textEmptyCartBanner: Locator = this.page
    .getByRole('status')
    .describe(`[${LABEL}] Empty cart banner`);

  // Q4 unresolved: cart-row testid absent — fallback: this.page.locator('.cart-row').nth(1).locator('.qty-input')
  // Q5 unresolved: qty input label unknown; spinbutton role assumed for type="number"
  readonly byCartRowQtyInput = (productNameFilter: string): Locator =>
    this.page
      .getByTestId('cart-row')
      .filter({ hasText: productNameFilter })
      .getByRole('spinbutton')
      .describe(`[${LABEL}] Qty input for item "${productNameFilter}"`);

  // Q11 unresolved: remove button accessible name unknown — assumed visible text or aria-label matches /remove/i
  // Fallback: this.page.locator('.cart-row .remove-btn')
  readonly byRemoveButton = (productNameFilter: string): Locator =>
    this.page
      .getByTestId('cart-row')
      .filter({ hasText: productNameFilter })
      .getByRole('button', { name: /remove/i })
      .describe(`[${LABEL}] Remove button for item "${productNameFilter}"`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.buttonCheckout,
      `[${LABEL}] Checkout button visible on page load`,
    ).toBeVisible();
  }

  async updateItemQuantity(productNameFilter: string, qty: string): Promise<void> {
    await this.byCartRowQtyInput(productNameFilter).fill(qty);
    await this.buttonUpdateCart.click();
    // Q13 guard: confirm async cart update committed before proceeding to checkout
    await expect(
      this.byCartRowQtyInput(productNameFilter),
      `[${LABEL}] Qty input holds updated value "${qty}"`,
    ).toHaveValue(qty);
  }

  async removeAllItems(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      // DOM re-queries each iteration; first() picks the next remaining remove button after prior removal
      await this.page.getByRole('button', { name: /remove/i }).first().click();
    }
  }

  async clickCheckout(): Promise<void> {
    await this.buttonCheckout.click();
  }
}
