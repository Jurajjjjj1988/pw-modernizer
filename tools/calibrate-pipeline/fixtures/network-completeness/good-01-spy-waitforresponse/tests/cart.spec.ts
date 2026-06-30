// See outputs/plans/cart.cy.js.md
import { test, expect } from "@fixtures/base.fixture";

test("loads the cart", async ({ page }) => {
  // The spy's wait is preserved as a waitForResponse sync point — no fabricated route.
  const cartResponse = page.waitForResponse("**/api/cart");
  await page.goto("/cart");
  await cartResponse;
  await expect(page.getByTestId("cart")).toBeVisible();
});
