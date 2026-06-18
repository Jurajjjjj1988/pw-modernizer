import { test as base, expect } from "@playwright/test";
import { setupProductsMock } from "@fixtures/products-mocks.fixture";
import { PageClassCart } from "@page-object/pages/cart.page";
import { PageClassDashboard } from "@page-object/pages/dashboard.page";
import { PageClassLogin } from "@page-object/pages/login.page";
import { PageClassProductListing } from "@page-object/pages/product-listing.page";
import { PageClassSearchFilters } from "@page-object/pages/search-filters.page";

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
  cartPage: PageClassCart;
  dashboardPage: PageClassDashboard;
  loginPage: PageClassLogin;
  productListingPage: PageClassProductListing;
  searchFiltersPage: PageClassSearchFilters;
};

const test = base.extend<Fixtures>({
  cartPage: async ({ page }, use) => use(new PageClassCart(page)),
  dashboardPage: async ({ page }, use) => use(new PageClassDashboard(page)),
  loginPage: async ({ page }, use) => use(new PageClassLogin(page)),
  productListingPage: async ({ page }, use) => {
    await setupProductsMock(page);
    await use(new PageClassProductListing(page));
  },
  searchFiltersPage: async ({ page }, use) => use(new PageClassSearchFilters(page)),
});

export { test, expect };
