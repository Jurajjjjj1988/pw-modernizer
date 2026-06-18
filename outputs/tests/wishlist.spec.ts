// Migrated by PWmodernizer on 2026-06-18 from cypress. See outputs/plans/wishlist.cy.js.md for plan.

import { test } from "@fixtures/base.fixture";

import { addProductToWishlist } from "@api/wishlist.api";

test.describe("Acme Shop wishlist", () => {
  // plan:scenario=1.1
  test(
    "adds a product to the wishlist from a product card @positive",
    async ({ productsPage }) => {
      await test.step("open the products page", async () => {
        await productsPage.open();
      });

      await test.step("add the first product card to the wishlist", async () => {
        await productsPage.clickAddToWishlistForCard(0);
      });

      await test.step("confirmation toast is visible", async () => {
        await productsPage.expectToastVisible();
      });

      await test.step("header badge shows count 1", async () => {
        await productsPage.expectHeaderBadgeCount("1");
      });

      const wishlistPage = await test.step(
        "navigate to the wishlist page via header link",
        () => productsPage.navigateToWishlist()
      );

      await test.step("wishlist page lists exactly 1 item", async () => {
        await wishlistPage.expectItemCount(1);
      });
    }
  );

  // plan:scenario=1.2
  test(
    "removes a product from the wishlist and restores the empty state @positive",
    async ({ request, wishlistPage }) => {
      await test.step("seed one product to wishlist via API", async () => {
        // TODO: Q7 unresolved — endpoint assumed POST /api/wishlist; confirm payload schema with backend team
        // TODO: Q12 unresolved — auth token required for wishlist API; replace empty string with session token
        await addProductToWishlist(request, "product-1", "");
      });

      await test.step("open the wishlist page", async () => {
        await wishlistPage.open();
      });

      await test.step("remove the single wishlist item", async () => {
        await wishlistPage.removeFirstItem();
      });

      await test.step("empty wishlist message is visible", async () => {
        await wishlistPage.expectEmptyMessageVisible();
      });

      await test.step("header badge shows count 0", async () => {
        await wishlistPage.expectHeaderBadgeCount("0");
      });
    }
  );
});
