// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/nth-selectors.spec.ts.md for plan and rationale.

export const PRODUCT_LINEN_TEE = "Linen Tee";
export const PRODUCT_WOOL_BEANIE = "Wool Beanie";
export const EXPECTED_CART_COUNT = "1";

export const PRODUCTS_MOCK_LIST = [
  { id: "p1", name: PRODUCT_LINEN_TEE, price: 29 },
  { id: "p2", name: "Denim Jacket", price: 119 },
  { id: "p3", name: PRODUCT_WOOL_BEANIE, price: 24 },
] as const;
