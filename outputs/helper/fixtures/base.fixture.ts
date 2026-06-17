import { test as base, expect } from "@playwright/test";

import { installProductsMock } from "@fixtures/products-mocks.fixture";
import { PageClassProductListing } from "@page-object/pages/product-listing.page";

/**
 * Single import source for `test` + `expect` in every spec.
 *
 * v0.2.0 qa-master baseline shell — checked into main so specs always have a valid
 * `@fixtures/base.fixture` to import from. Per-migration extensions add page-object fixtures
 * via `test = base.extend<{...}>({...})`; this shell stays minimal.
 *
 * The ONLY file in the repo allowed to import from `@playwright/test`. Every other spec/helper
 * imports `test` + `expect` from here. `validate-qa-master-conformance.ts` enforces this.
 */

type Fixtures = {
  productsMocks: void;
  productListingPage: PageClassProductListing;
};

const test = base.extend<Fixtures>({
  productsMocks: [
    async ({ page }, use) => {
      await installProductsMock(page);
      await use();
    },
    { auto: true },
  ],
  productListingPage: async ({ page }, use) =>
    use(new PageClassProductListing(page)),
});

export { test, expect };
