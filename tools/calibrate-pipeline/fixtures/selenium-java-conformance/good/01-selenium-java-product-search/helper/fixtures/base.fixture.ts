import { test as base, expect } from "@playwright/test";

import { PageClassProductSearch } from "@page-object/pages/product-search.page";

/**
 * Per-migration extension of the qa-master base fixture. This file is the
 * ONLY one in the selenium-java-product-search migration allowed to import
 * `test` from `@playwright/test`; every spec imports from
 * `@fixtures/base.fixture` (this barrel).
 */
type Fixtures = {
  productSearchPage: PageClassProductSearch;
};

const test = base.extend<Fixtures>({
  productSearchPage: async ({ page }, use) => {
    await use(new PageClassProductSearch(page));
  },
});

export { test, expect };
