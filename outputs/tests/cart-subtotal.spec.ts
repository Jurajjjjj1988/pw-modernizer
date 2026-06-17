// Migrated from bad-playwright on 2026-06-17 by Migrator.
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

      await test.step("add linen tee to cart", async () => {
        await cartPage.addItem(PRODUCT_LINEN_TEE);
      });

      await test.step("add denim jacket to cart", async () => {
        await cartPage.addItem(PRODUCT_DENIM_JACKET);
      });

      await test.step("cart subtotal shows combined price", async () => {
        await cartPage.expectSubtotalToHaveText(EXPECTED_SUBTOTAL);
      });
    }
  );

  // plan:scenario=1.2
  test(
    "[CART-2] - Check that setting item quantity to zero clears the cart @positive",
    async ({ cartPage }) => {
      await test.step("open the cart page", async () => {
        await cartPage.open();
      });

      await test.step("add wool beanie to cart", async () => {
        await cartPage.addItem(PRODUCT_WOOL_BEANIE);
      });

      await test.step("set quantity to zero", async () => {
        await cartPage.setQuantityToZero();
      });

      await test.step("update cart", async () => {
        await cartPage.clickUpdate();
      });

      await test.step("empty cart message is visible", async () => {
        await cartPage.expectEmptyCartVisible();
      });
    }
  );
});
