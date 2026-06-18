// Migrated from cypress on 2026-06-18 by Migrator.
// See outputs/plans/wishlist.cy.js.md for plan and rationale.

import { expect, type APIRequestContext } from "@playwright/test";

// Q7 unresolved: endpoint paths assumed; confirm POST /api/wishlist payload schema and DELETE /api/wishlist with backend team
const WISHLIST_API_PATH = "/api/wishlist";

/**
 * Seed a product into the wishlist via API — data prep for scenario 1.2 (avoids UI-add in setup).
 * Q7 unresolved: endpoint and auth shape TBD; Q12 unresolved: auth token source TBD.
 */
export async function addProductToWishlist(
  request: APIRequestContext,
  productId: string,
  authToken: string
): Promise<void> {
  const response = await request.post(WISHLIST_API_PATH, {
    data: { productId },
    headers: { Authorization: `Bearer ${authToken}` },
  });
  // Q7 unresolved: confirm whether successful add returns 200 or 201
  expect(
    [200, 201].includes(response.status()),
    `[Wishlist API] addProductToWishlist: expected 200 or 201, got ${response.status()}`
  ).toBeTruthy();
}

/**
 * Remove all wishlist items via API — teardown helper to prevent cross-test state leakage.
 * Q7 unresolved: endpoint and auth shape TBD.
 */
export async function clearWishlist(
  request: APIRequestContext,
  authToken: string
): Promise<void> {
  const response = await request.delete(WISHLIST_API_PATH, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  // Q7 unresolved: confirm whether successful delete returns 200 or 204
  expect(
    [200, 204].includes(response.status()),
    `[Wishlist API] clearWishlist: expected 200 or 204, got ${response.status()}`
  ).toBeTruthy();
}
