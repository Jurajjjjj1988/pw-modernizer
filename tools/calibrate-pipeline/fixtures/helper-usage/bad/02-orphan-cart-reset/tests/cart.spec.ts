// Calibration fixture (bad case): the spec consumes only the add helper. The
// teardown wrapper from the api file is never imported here, so the validator
// must flag it as unreferenced. (Intentionally not naming the dead helper in
// this comment — a literal mention would defeat the word-boundary check.)

import { test, expect } from "@playwright/test";
import { addToCart } from "../helper/api/cart.api";

test("adds a sku to the cart", async ({ request, page }) => {
  await addToCart(request, "sku-backpack");
  await page.goto("/cart");
  await expect(page.getByRole("listitem")).toHaveCount(1);
});
