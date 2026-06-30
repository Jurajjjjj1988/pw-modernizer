// See outputs/plans/checkout.cy.js.md
import { test, expect } from "@fixtures/base.fixture";

test("pays", async ({ page }) => {
  await page.route("**/api/checkout/pay", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ orderId: "ord_1" }) });
  });
  await page.goto("/checkout");
  const payResponse = page.waitForResponse("**/api/checkout/pay");
  await page.getByRole("button", { name: "Pay now" }).click();
  const response = await payResponse;
  expect(response.status()).toBe(201);
});
