import { test, expect } from "@playwright/test";
import { CheckoutPage } from "./pages/checkout.page";

test.describe("checkout", () => {
  let checkout: CheckoutPage;

  test.beforeEach(async ({ page }) => {
    checkout = new CheckoutPage(page);
    await checkout.goto();
  });

  // plan:scenario=1.1
  test("completes a checkout with valid card @positive", async ({ page }) => {
    await checkout.setQuantity({ row: 0, qty: 2 });
    await checkout.proceedToShipping();
    await checkout.fillShipping({ name: "Jane Doe", address: "1 Acme Way", city: "Brno" });
    await checkout.fillCard({ number: "4242424242424242" });
    await checkout.pay();
    await expect(checkout.thankYou).toBeVisible();
    await expect(page).toHaveURL(/\/thanks/);
  });
});
