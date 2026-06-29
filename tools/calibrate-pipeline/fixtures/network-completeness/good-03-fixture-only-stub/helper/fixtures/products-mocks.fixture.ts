// A mock-fixture parking the /api/products route stub. The spec does not import
// this through an @alias the collectEmittedFiles import-walk can see, so only the
// fixture-scan (helper/fixtures/ + helper/actions/) folds it into the diff input.
import { test as base } from "@playwright/test";

const PRODUCTS = [{ id: 1, name: "Mug" }];

export const test = base.extend({
  mockProducts: [async ({ page }, use) => {
    await page.route("**/api/products", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
    });
    await use();
  }, { auto: true }],
});
