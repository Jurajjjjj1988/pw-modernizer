// Calibration fixture (bad case): spec only consumes the add helper. The
// teardown helper from the api file is never imported here so the validator
// must flag it as unreferenced. (Intentionally not naming the dead helper
// in this comment — a literal mention would defeat the word-boundary check.)

import { test, expect } from "@playwright/test";
import { addProductToWishlist } from "../helper/api/wishlist.api";

test("adds product to wishlist", async ({ request, page }) => {
  await addProductToWishlist(request, "product-1");
  await page.goto("/wishlist");
  await expect(page.getByRole("listitem")).toHaveCount(1);
});
