// Calibration fixture (good case): spec consumes BOTH addToCart and emptyCart,
// so the validator must stay silent under --strict.

import { test, expect } from "@playwright/test";
import { addToCart, emptyCart } from "../helper/api/cart.api";

test.afterEach(async ({ request }) => {
  await emptyCart(request);
});

test("adds a sku to the cart", async ({ request, page }) => {
  await addToCart(request, "sku-backpack");
  await page.goto("/cart");
  await expect(page.getByRole("listitem")).toHaveCount(1);
});
