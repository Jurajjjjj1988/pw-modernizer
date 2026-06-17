// Migrated from bad-playwright on 2026-06-17 by Migrator. See outputs/plans/nth-selectors.spec.ts.md for plan.
import type { Page } from "@playwright/test";

import { PRODUCTS_MOCK_LIST } from "@test-data/products";

export async function installProductsMock(page: Page): Promise<void> {
  await page.route("**/api/products*", async (route) => {
    await route.fulfill({ status: 200, json: PRODUCTS_MOCK_LIST });
  });
}
