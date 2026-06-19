// Calibration fixture (bad case): the cart-reset wrapper is exported but the
// spec never wires it into a teardown hook, so cart state leaks across runs.
// Models the PR #126 class of bug on an API teardown helper.

import { type APIRequestContext, expect } from "@playwright/test";

const CART_API_PATH = "/api/cart";

export async function addToCart(
  request: APIRequestContext,
  sku: string,
): Promise<void> {
  const response = await request.post(CART_API_PATH, { data: { sku } });
  expect([200, 201].includes(response.status())).toBeTruthy();
}

export async function resetCartState(request: APIRequestContext): Promise<void> {
  const response = await request.delete(CART_API_PATH);
  expect([200, 204].includes(response.status())).toBeTruthy();
}
