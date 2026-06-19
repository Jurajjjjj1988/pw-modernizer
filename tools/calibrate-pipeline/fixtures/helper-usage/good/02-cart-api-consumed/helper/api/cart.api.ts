// Calibration fixture (good case): every exported cart helper is consumed by
// the spec — addToCart in the test body, emptyCart in the teardown hook.

import { type APIRequestContext, expect } from "@playwright/test";

const CART_API_PATH = "/api/cart";

export async function addToCart(
  request: APIRequestContext,
  sku: string,
): Promise<void> {
  const response = await request.post(CART_API_PATH, { data: { sku } });
  expect([200, 201].includes(response.status())).toBeTruthy();
}

export async function emptyCart(request: APIRequestContext): Promise<void> {
  const response = await request.delete(CART_API_PATH);
  expect([200, 204].includes(response.status())).toBeTruthy();
}
