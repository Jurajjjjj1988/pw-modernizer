import { test, expect } from "@playwright/test";

import { PageClassProductSearch } from "@page-object/pages/product-search.page";

/**
 * Bad fixture - seeded with 4 anti-patterns. See ../README.md.
 */
test.describe(
  "Storefront: product search",
  { tag: ["@desktop", "@search"] },
  () => {
    test(
      "[QA-301] - Check that searching a known term returns at least one result",
      { tag: ["@smoke"] },
      async ({ page }) => {
        const productSearchPage = new PageClassProductSearch(page);
        await page.goto("/");
        await page.waitForTimeout(2000);

        await productSearchPage.searchFor("sneakers");
        await expect(productSearchPage.arrayResultCards).not.toHaveCount(0);
      },
    );
  },
);
