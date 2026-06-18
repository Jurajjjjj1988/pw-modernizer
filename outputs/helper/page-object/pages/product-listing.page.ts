// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/nth-selectors.spec.ts.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { BlockClassCartDrawer } from "@page-object/blocks/cart-drawer.block";
import { LABEL_PRODUCT_LISTING } from "@test-data/labels";
import { URL_PRODUCTS } from "@test-data/urls";

const LABEL = LABEL_PRODUCT_LISTING;

export class PageClassProductListing extends BasePage {
  readonly url = URL_PRODUCTS;

  // Q1 unresolved: product card element role not confirmed — assumed article
  // Reviewer fallback: verify element tag/role; if not article ask FE to add data-testid="product-card"
  readonly arrayProductCards: Locator = this.page
    .getByRole("article")
    .describe(`[${LABEL}] product card collection`);

  // Q4 unresolved: cart-count testid not confirmed
  // Reviewer fallback: add data-testid="cart-count" to badge span; or use getByRole('status')
  readonly textCartBadgeCount: Locator = this.page
    .getByTestId("cart-count")
    .describe(`[${LABEL}] cart badge count`);

  // Q5 unresolved: cart icon role (link vs button) and accessible name not confirmed
  // Reviewer fallback: use getByRole('button', { name: /cart/i }) if element is a <button>
  readonly linkCart: Locator = this.page
    .getByRole("link", { name: /cart/i })
    .describe(`[${LABEL}] cart navigation link`);

  // Q1 unresolved: product card element role assumed article; product name rendered inside card assumed
  readonly byProductCard = (productName: string): Locator =>
    this.arrayProductCards
      .filter({ hasText: new RegExp(productName, "i") })
      .describe(`[${LABEL}] product card: ${productName}`);

  // Q3 unresolved: add-to-cart button accessible name not confirmed — assumed /add to cart/i
  // Reviewer fallback: add aria-label="Add to cart" or data-testid="add-to-cart-button"
  readonly byProductAddToCartButton = (productName: string): Locator =>
    this.byProductCard(productName)
      .getByRole("button", { name: /add to cart/i })
      .describe(`[${LABEL}] add-to-cart button: ${productName}`);

  // Q6 unresolved: cart-drawer testid not confirmed — assumed data-testid="cart-drawer"
  readonly blockCartDrawer = new BlockClassCartDrawer(
    this.page.locator('[data-testid="cart-drawer"]')
  );

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.arrayProductCards.first(),
      `[${LABEL}] at least one product card visible`
    ).toBeVisible();
  }

  async addProductToCart(productName: string): Promise<void> {
    await this.byProductAddToCartButton(productName).click();
  }

  async openCart(): Promise<void> {
    await this.linkCart.click();
  }

  async expectCartBadgeCount(expectedCount: string): Promise<void> {
    await expect(
      this.textCartBadgeCount,
      `[${LABEL}] cart badge shows expected count`
    ).toHaveText(expectedCount);
  }
}
