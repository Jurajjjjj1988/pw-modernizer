// Calibration fixture (good case): every exported helper is consumed by the spec.
// Models the post-fix state where Stage 2 wires teardown helpers into afterEach.

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
