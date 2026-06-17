// Migrated from bad-playwright on 2026-06-17 by Migrator. See outputs/plans/nth-selectors.spec.ts.md for plan.
import { expect, type Locator } from "@playwright/test";

import { BaseBlock } from "@page-object/baseblock";
import { LABEL_CART_DRAWER } from "@test-data/labels";

export class BlockClassCartDrawer extends BaseBlock {
  // Q6 unresolved: cart-drawer testid not confirmed — root is the drawer container passed from the page
  readonly containerDrawer: Locator = this.root.describe(
    `[${LABEL_CART_DRAWER}] Cart drawer panel`,
  );

  // Q8 unresolved: empty-cart message copy not confirmed — assumed /your cart is empty/i
  readonly textEmptyMessage: Locator = this.root
    .getByText(/your cart is empty/i)
    .describe(`[${LABEL_CART_DRAWER}] Empty cart message`);

  readonly byCartItem = (productName: string): Locator =>
    this.root
      .getByRole("listitem")
      .filter({ hasText: new RegExp(productName, "i") })
      .describe(`[${LABEL_CART_DRAWER}] Cart item: ${productName}`);

  // Q7 unresolved: remove button accessible name not confirmed — assumed /remove/i
  readonly byRemoveButton = (productName: string): Locator =>
    this.byCartItem(productName)
      .getByRole("button", { name: /remove/i })
      .describe(`[${LABEL_CART_DRAWER}] Remove button for ${productName}`);

  async removeItem(productName: string): Promise<void> {
    await this.byRemoveButton(productName).click();
  }

  async waitForEmpty(): Promise<void> {
    await expect(
      this.textEmptyMessage,
      `[${LABEL_CART_DRAWER}] Empty-cart message should be visible`,
    ).toBeVisible();
  }
}
