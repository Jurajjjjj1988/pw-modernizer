// See outputs/plans/checkout.cy.js.md
import { test, expect } from "@fixtures/base.fixture";

test("pays", async ({ page }) => {
  // The codemod dropped the cy.intercept stub: no page.route, no waitForResponse.
  // The test navigates and clicks, then asserts the confirmation URL — passing for
  // the WRONG reason against the real backend (false-green).
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay now" }).click();
  await expect(page).toHaveURL(/order-confirmed/);
});
