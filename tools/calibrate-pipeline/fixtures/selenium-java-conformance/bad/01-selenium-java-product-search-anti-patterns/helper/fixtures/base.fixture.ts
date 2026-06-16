import { test as base, expect } from "@playwright/test";

import { PageClassProductSearch } from "@page-object/pages/product-search.page";

type Fixtures = {
  productSearchPage: PageClassProductSearch;
};

const test = base.extend<Fixtures>({
  productSearchPage: async ({ page }, use) => {
    await use(new PageClassProductSearch(page));
  },
});

export { test, expect };
