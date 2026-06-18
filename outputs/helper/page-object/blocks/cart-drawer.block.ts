// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/nth-selectors.spec.ts.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BaseBlock } from "@page-object/baseblock";
import { LABEL_CART_DRAWER } from "@test-data/labels";

const LABEL = LABEL_CART_DRAWER;

export class BlockClassCartDrawer extends BaseBlock {
  // Q6 unresolved: cart-drawer testid not confirmed — block root is scoped to the drawer panel
  readonly containerDrawer: Locator = this.root.describe(
    `[${LABEL}] cart drawer panel`
  );

  // Q8 unresolved: empty-cart message copy not confirmed — assumed /your cart is empty/i
  // Reviewer fallback: confirm wording or add data-testid="cart-empty-message"
  readonly textEmptyMessage: Locator = this.root
    .getByText(/your cart is empty/i)
    .describe(`[${LABEL}] empty-cart message`);

  // Q6 unresolved: cart-drawer testid not confirmed — listitem role within drawer assumed
  readonly byCartItem = (productName: string): Locator =>
    this.root
      .getByRole("listitem")
      .filter({ hasText: new RegExp(productName, "i") })
      .describe(`[${LABEL}] cart item: ${productName}`);

  // Q7 unresolved: remove button accessible name not confirmed — assumed /remove/i
  // Reviewer fallback: add aria-label="Remove item" or data-testid="remove-item-button"
  readonly byRemoveButton = (productName: string): Locator =>
    this.byCartItem(productName)
      .getByRole("button", { name: /remove/i })
      .describe(`[${LABEL}] remove button for: ${productName}`);

  async removeItem(productName: string): Promise<void> {
    await this.byRemoveButton(productName).click();
  }

  async waitForEmpty(): Promise<void> {
    await expect(
      this.textEmptyMessage,
      `[${LABEL}] empty-cart message visible after removal`
    ).toBeVisible();
  }
}
