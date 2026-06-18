// Migrated from cypress on 2026-06-18 by Migrator.
// See outputs/plans/wishlist.cy.js.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { PageClassWishlist } from "@page-object/pages/wishlist.page";
import { LABEL_PRODUCTS } from "@test-data/labels";

export class PageClassProducts extends BasePage {
  readonly url = "/products";

  readonly headingProducts: Locator = this.page
    .getByRole("heading", { name: /products/i })
    .describe(`[${LABEL_PRODUCTS}] Page heading`);

  // Q1 unresolved: button accessible name inferred from CSS class — may be icon-only with aria-label; see pin 2
  readonly buttonAddToWishlist: Locator = this.page
    .getByRole("button", { name: /add to wishlist/i })
    .describe(`[${LABEL_PRODUCTS}] Add to wishlist button`);

  // Q11 unresolved: toast ARIA role unknown — text-based fallback used instead of getByRole('status') or getByRole('alert'); see pin 6
  readonly textToastAddedToWishlist: Locator = this.page
    .getByText("Added to wishlist")
    .describe(`[${LABEL_PRODUCTS}] Added to wishlist toast notification`);

  // Q4 unresolved: count badge has no testid or ARIA evidence — CSS class fallback used; see pin 3
  readonly textHeaderWishlistCount: Locator = this.page
    .locator(".header-wishlist-count")
    .describe(`[${LABEL_PRODUCTS}] Header wishlist count badge`);

  // Q5 unresolved: link accessible name inferred from CSS class — may be icon-only link with no accessible name; see pin 7
  readonly linkHeaderWishlist: Locator = this.page
    .getByRole("link", { name: /wishlist/i })
    .describe(`[${LABEL_PRODUCTS}] Header wishlist navigation link`);

  // Q6 unresolved: no accessible product name available — article role inferred from <article> element; index fallback used; see pin 1
  readonly byProductCard = (n: number): Locator =>
    this.page
      .getByRole("article")
      .nth(n) // TODO: fragile selector — add data-testid per Q6
      .describe(`[${LABEL_PRODUCTS}] Product card at index ${n}`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.headingProducts,
      `[${LABEL_PRODUCTS}] Page heading visible`
    ).toBeVisible();
  }

  // TODO: Q6 unresolved — index-based card selection; add data-testid per Q6 for stable targeting
  async clickAddToWishlistForCard(index: number): Promise<void> {
    await this.byProductCard(index)
      .getByRole("button", { name: /add to wishlist/i })
      .click();
  }

  async expectToastVisible(): Promise<void> {
    await expect(
      this.textToastAddedToWishlist,
      `[${LABEL_PRODUCTS}] Toast 'Added to wishlist' visible`
    ).toBeVisible();
  }

  async expectHeaderBadgeCount(count: string): Promise<void> {
    await expect(
      this.textHeaderWishlistCount,
      `[${LABEL_PRODUCTS}] Header badge shows count ${count}`
    ).toHaveText(count);
  }

  // Creates waitForResponse promise BEFORE click per KB-1.2.7; awaits after click resolves
  async navigateToWishlist(): Promise<PageClassWishlist> {
    const responsePromise = this.page.waitForResponse(
      (response) => response.url().includes("/api/wishlist"),
      { timeout: 15_000 }
    );
    await this.linkHeaderWishlist.click();
    await responsePromise;
    const wishlistPage = new PageClassWishlist(this.page);
    await wishlistPage.waitForPageLoad();
    return wishlistPage;
  }
}
