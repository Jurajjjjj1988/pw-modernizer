import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from inputs/selenium-java/CheckoutFlow.java. The JUnit source ran
 * a full add-to-cart → checkout → confirmation flow with Thread.sleep between
 * steps; qa-master splits the work across CartPage + CheckoutPage POMs and an
 * orders API wrapper, replacing every sleep with a web-first assertion.
 */
test.describe("Checkout: happy path", { tag: ["@desktop", "@checkout"] }, () => {
  test(
    "[QA-510] - Check that a single-item cart completes checkout",
    { tag: ["@smoke"] },
    async ({ cartPage, checkoutPage }) => {
      await test.step("Add an item and open the cart", async () => {
        await cartPage.open();
        await cartPage.addItem("Sauce Labs Backpack");
        await expect(
          cartPage.badgeCount,
          "Cart badge should reflect the single added item",
        ).toHaveText("1");
      });

      await test.step("Complete checkout", async () => {
        await checkoutPage.open();
        await checkoutPage.fillContact("Ada", "Lovelace", "10001");
        await checkoutPage.finish();
        await expect(
          checkoutPage.headingConfirmation,
          "Confirmation heading should render after finishing checkout",
        ).toBeVisible();
      });
    },
  );
});
