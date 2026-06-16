import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from a JUnit + WebDriver add-to-cart test. The source used
 * Thread.sleep between steps; qa-master delegates the interaction to CartPage
 * and replaces the sleeps with a web-first badge assertion.
 */
test.describe("Cart: add to cart", { tag: ["@desktop", "@cart"] }, () => {
  test(
    "[QA-210] - Check that adding the backpack increments the cart badge",
    {
      annotation: [
        {
          type: "Test",
          description:
            "Adding the backpack to the cart increments the cart badge to one",
        },
      ],
      tag: ["@smoke"],
    },
    async ({ cartPage }) => {
      await test.step("Open the inventory page", async () => {
        await cartPage.open();
        await expect(
          cartPage.buttonAddBackpack,
          "Add-backpack button should be visible on the inventory page",
        ).toBeVisible();
      });

      await test.step("Add the backpack to the cart", async () => {
        await cartPage.addBackpack();
        await expect(
          cartPage.badgeCount,
          "Cart badge should reflect the single added item",
        ).toHaveText("1");
      });
    },
  );
});
