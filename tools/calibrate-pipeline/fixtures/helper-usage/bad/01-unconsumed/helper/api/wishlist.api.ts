// Calibration fixture (bad case): clearWishlist is exported but never wired
// into the spec. Models the bug PR #126 SDET found on cypress wishlist:
// teardown helper present in the API layer but spec doesn't call it, so test
// state leaks across runs.

import { type APIRequestContext, expect } from "@playwright/test";

const WISHLIST_API_PATH = "/api/wishlist";

export async function addProductToWishlist(
  request: APIRequestContext,
  productId: string,
): Promise<void> {
  const response = await request.post(WISHLIST_API_PATH, { data: { productId } });
  expect([200, 201].includes(response.status())).toBeTruthy();
}

export async function clearWishlist(request: APIRequestContext): Promise<void> {
  const response = await request.delete(WISHLIST_API_PATH);
  expect([200, 204].includes(response.status())).toBeTruthy();
}
