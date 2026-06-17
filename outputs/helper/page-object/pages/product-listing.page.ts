// Migrated from bad-playwright on 2026-06-17 by Migrator. See outputs/plans/nth-selectors.spec.ts.md for plan.
import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { BlockClassCartDrawer } from "@page-object/blocks/cart-drawer.block";
import { LABEL_PRODUCT_LISTING } from "@test-data/labels";

export class PageClassProductListing extends BasePage {
  readonly url = "/products";

  // Q1 unresolved: product card element role not confirmed — assumed article
  readonly arrayProductCards: Locator = this.page
    .getByRole("article")
    .describe(`[${LABEL_PRODUCT_LISTING}] Product cards`);

  // Q4 unresolved: cart-count testid not confirmed — assumed data-testid="cart-count"
  readonly textCartBadgeCount: Locator = this.page
    .getByTestId("cart-count")
    .describe(`[${LABEL_PRODUCT_LISTING}] Cart badge count`);

  // Q5 unresolved: cart icon role (link vs button) not confirmed — assumed link
  readonly linkCart: Locator = this.page
    .getByRole("link", { name: /cart/i })
    .describe(`[${LABEL_PRODUCT_LISTING}] Cart navigation link`);

  // Q6 unresolved: cart-drawer testid not confirmed — assumed data-testid="cart-drawer"
  readonly blockCartDrawer = new BlockClassCartDrawer(
    this.page.locator('[data-testid="cart-drawer"]'),
  );

  // Q1 unresolved: product card element role not confirmed — assumed article
  readonly byProductCard = (productName: string): Locator =>
    this.arrayProductCards
      .filter({ hasText: new RegExp(productName, "i") })
      .describe(`[${LABEL_PRODUCT_LISTING}] Product card: ${productName}`);

  // Q3 unresolved: add-to-cart button accessible name not confirmed — assumed /add to cart/i
  readonly byProductAddToCartButton = (productName: string): Locator =>
    this.byProductCard(productName)
      .getByRole("button", { name: /add to cart/i })
      .describe(
        `[${LABEL_PRODUCT_LISTING}] Add-to-cart button for ${productName}`,
      );

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.arrayProductCards.first(),
      `[${LABEL_PRODUCT_LISTING}] At least one product card should be visible`,
    ).toBeVisible();
  }

  async addProductToCart(productName: string): Promise<void> {
    await this.byProductAddToCartButton(productName).click();
  }

  async openCart(): Promise<void> {
    await this.linkCart.click();
  }
}
