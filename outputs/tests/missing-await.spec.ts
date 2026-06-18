// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/missing-await.spec.ts.md for plan and rationale.

import { test } from "@fixtures/base.fixture";

const EXPECTED_SUBTOTAL = "$148";
const PRODUCT_LINEN_TEE = "Add Linen Tee";
const PRODUCT_DENIM_JACKET = "Add Denim Jacket";
const PRODUCT_WOOL_BEANIE = "Add Wool Beanie";

test.describe("Acme Shop cart", () => {
  // plan:scenario=1.1
  test(
    "[CART-1] - Check that cart subtotal reflects sum of added items @positive",
    async ({ cartPage }) => {
      await test.step("open the cart page", async () => {
        await cartPage.open();
      });

      await test.step("add Linen Tee to cart", async () => {
        await cartPage.clickAddItem(PRODUCT_LINEN_TEE);
      });

      await test.step("add Denim Jacket to cart", async () => {
        await cartPage.clickAddItem(PRODUCT_DENIM_JACKET);
      });

      await test.step("subtotal shows combined price", async () => {
        await cartPage.expectSubtotalText(EXPECTED_SUBTOTAL);
      });
    }
  );

  // plan:scenario=1.2
  test(
    "[CART-2] - Check that setting item quantity to zero clears the cart @edge",
    async ({ cartPage }) => {
      await test.step("open the cart page", async () => {
        await cartPage.open();
      });

      await test.step("add Wool Beanie to cart", async () => {
        await cartPage.clickAddItem(PRODUCT_WOOL_BEANIE);
      });

      await test.step("set quantity to zero and update", async () => {
        await cartPage.fillQuantity("0");
        await cartPage.clickUpdate();
      });

      await test.step("empty cart message is visible", async () => {
        await cartPage.expectEmptyCartVisible();
      });
    }
  );
});
