import { test, expect } from "@fixtures/base.fixture";

/**
 * The basename derives correctly and the claimed Output LOC matches this
 * file, so the only violation is the report's LOC delta being arithmetically
 * inconsistent with its own Source LOC → Output LOC numbers.
 */
test.describe("Checkout: happy path", { tag: ["@desktop", "@checkout"] }, () => {
  test(
    "[QA-510] - Check that a single-item cart completes checkout",
    { tag: ["@smoke"] },
    async ({ cartPage, checkoutPage }) => {
      await cartPage.open();
      await cartPage.addItem("Sauce Labs Backpack");
      await checkoutPage.open();
      await checkoutPage.finish();
      await expect(
        checkoutPage.headingConfirmation,
        "Confirmation heading should render after finishing checkout",
      ).toBeVisible();
    },
  );
});
