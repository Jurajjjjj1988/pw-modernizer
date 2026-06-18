// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/nth-selectors.spec.ts.md for plan and rationale.

import type { Page } from "@playwright/test";

import { PRODUCTS_MOCK_LIST } from "@test-data/products";

// Intercepts GET /api/products* with the fixed mock payload used by the product-listing tests.
// Called from base.fixture.ts inside the productListingPage fixture before use() — the mock is
// registered before page navigation so the first goto() already sees the stub.
export async function setupProductsMock(page: Page): Promise<void> {
  await page.route("**/api/products*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PRODUCTS_MOCK_LIST),
    });
  });
}
