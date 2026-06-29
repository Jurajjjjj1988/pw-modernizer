// See outputs/plans/products.cy.js.md
import { test, expect } from "@fixtures/base.fixture";

// The route stub is supplied by the mockProducts worker fixture (auto), so the
// spec itself never calls page.route — it only navigates and asserts.
test("lists products", async ({ page }) => {
  await page.goto("/products");
  await expect(page.getByTestId("grid")).toBeVisible();
});
