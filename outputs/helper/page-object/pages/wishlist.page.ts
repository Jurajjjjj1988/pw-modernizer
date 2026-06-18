// Migrated from cypress on 2026-06-18 by Migrator.
// See outputs/plans/wishlist.cy.js.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { LABEL_WISHLIST } from "@test-data/labels";

export class PageClassWishlist extends BasePage {
  // Q10 unresolved: URL assumed to be /wishlist; confirm with app routing
  readonly url = "/wishlist";

  readonly headingWishlist: Locator = this.page
    .getByRole("heading", { name: /wishlist/i })
    .describe(`[${LABEL_WISHLIST}] Page heading`);

  // Q2 unresolved: wishlist item element type unknown — CSS class fallback used; see pin 4
  readonly arrayWishlistItems: Locator = this.page
    .locator(".wishlist-item")
    .describe(`[${LABEL_WISHLIST}] Wishlist item list`);

  // Q9 unresolved: button accessible name inferred from CSS class — may be icon-only with aria-label; see pin 2
  readonly buttonRemoveFromWishlist: Locator = this.page
    .getByRole("button", { name: /remove from wishlist/i })
    .describe(`[${LABEL_WISHLIST}] Remove from wishlist button`);

  // Q3 unresolved: empty-state text content unknown — regex guess used; see pin 5
  readonly textEmptyMessage: Locator = this.page
    .getByText(/your wishlist is empty/i)
    .describe(`[${LABEL_WISHLIST}] Empty wishlist message`);

  // Q4 unresolved: count badge has no testid or ARIA evidence — CSS class fallback used; see pin 3
  readonly textHeaderWishlistCount: Locator = this.page
    .locator(".header-wishlist-count")
    .describe(`[${LABEL_WISHLIST}] Header wishlist count badge`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.headingWishlist,
      `[${LABEL_WISHLIST}] Page heading visible`
    ).toBeVisible();
  }

  async expectItemCount(count: number): Promise<void> {
    await expect(
      this.arrayWishlistItems,
      `[${LABEL_WISHLIST}] Wishlist shows ${count} item(s)`
    ).toHaveCount(count);
  }

  async removeFirstItem(): Promise<void> {
    // TODO: fragile selector — .first() acceptable here as test guarantees exactly 1 item; add data-testid per Q9
    await this.buttonRemoveFromWishlist.first().click();
  }

  async expectEmptyMessageVisible(): Promise<void> {
    await expect(
      this.textEmptyMessage,
      `[${LABEL_WISHLIST}] Empty wishlist message visible`
    ).toBeVisible();
  }

  async expectHeaderBadgeCount(count: string): Promise<void> {
    await expect(
      this.textHeaderWishlistCount,
      `[${LABEL_WISHLIST}] Header badge shows count ${count}`
    ).toHaveText(count);
  }
}
