// Calibration fixture (good case): spec consumes BOTH addProductToWishlist
// and clearWishlist. The validator must stay silent.

import { test, expect } from "@playwright/test";
import { addProductToWishlist, clearWishlist } from "../helper/api/wishlist.api";

test.afterEach(async ({ request }) => {
  await clearWishlist(request);
});

test("adds product to wishlist", async ({ request, page }) => {
  await addProductToWishlist(request, "product-1");
  await page.goto("/wishlist");
  await expect(page.getByRole("listitem")).toHaveCount(1);
});
