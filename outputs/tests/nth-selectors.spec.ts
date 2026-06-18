// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/nth-selectors.spec.ts.md for plan and rationale.

import { test } from "@fixtures/base.fixture";

import {
  EXPECTED_CART_COUNT,
  PRODUCT_LINEN_TEE,
  PRODUCT_WOOL_BEANIE,
} from "@test-data/products";

test.describe(
  "Product listing — cart interactions",
  { tag: ["@positive"] },
  () => {
    test.beforeEach(async ({ productListingPage }) => {
      await productListingPage.open();
    });

    // plan:scenario=1.1
    test(
      "[PL-1] - Check that adding a product increments the cart badge count",
      async ({ productListingPage }) => {
        await test.step("add Wool Beanie to cart", async () => {
          await productListingPage.addProductToCart(PRODUCT_WOOL_BEANIE);
        });

        await test.step("cart badge shows count of 1", async () => {
          await productListingPage.expectCartBadgeCount(EXPECTED_CART_COUNT);
        });
      }
    );

    // plan:scenario=1.2
    test(
      "[PL-2] - Check that removing the only cart item shows the empty-cart message",
      { tag: ["@edge"] },
      async ({ productListingPage }) => {
        await test.step("add Linen Tee to cart", async () => {
          await productListingPage.addProductToCart(PRODUCT_LINEN_TEE);
        });

        await test.step("cart badge confirms add succeeded", async () => {
          await productListingPage.expectCartBadgeCount(EXPECTED_CART_COUNT);
        });

        await test.step("open cart drawer", async () => {
          await productListingPage.openCart();
        });

        await test.step("remove Linen Tee from the cart", async () => {
          await productListingPage.blockCartDrawer.removeItem(PRODUCT_LINEN_TEE);
        });

        await test.step("empty-cart message is visible in the drawer", async () => {
          await productListingPage.blockCartDrawer.waitForEmpty();
        });
      }
    );
  }
);
