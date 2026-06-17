// Migrated from bad-playwright on 2026-06-17 by Migrator. See outputs/plans/nth-selectors.spec.ts.md for plan.

import { test, expect } from "@fixtures/base.fixture";

import { EXPECTED_CART_COUNT } from "@test-data/products";

test.describe("Product listing — cart interactions", { tag: ["@positive"] }, () => {
  test.beforeEach(async ({ productListingPage }) => {
    await productListingPage.open();
  });

  // plan:scenario=1.1
  test(
    "[PL-1] - Check that adding a product increments the cart badge count",
    async ({ productListingPage }) => {
      await test.step("add Wool Beanie to the cart", async () => {
        await productListingPage.addProductToCart("Wool Beanie");
      });

      await test.step("cart badge shows count of 1", async () => {
        await expect(
          productListingPage.textCartBadgeCount,
          "[Product listing] Cart badge count should equal '1' after adding to cart",
        ).toHaveText(EXPECTED_CART_COUNT);
      });
    },
  );

  // plan:scenario=1.2
  test(
    "[PL-2] - Check that removing the only cart item shows the empty-cart message",
    { tag: ["@edge"] },
    async ({ productListingPage }) => {
      await test.step("add Linen Tee to the cart", async () => {
        await productListingPage.addProductToCart("Linen Tee");
      });

      await test.step("open the cart drawer", async () => {
        await productListingPage.openCart();
      });

      await test.step("remove Linen Tee from the cart drawer", async () => {
        await productListingPage.blockCartDrawer.removeItem("Linen Tee");
      });

      await test.step("cart drawer shows the empty-cart message", async () => {
        await productListingPage.blockCartDrawer.waitForEmpty();
      });
    },
  );
});
