import { test as base, expect } from "@playwright/test";
import { PageClassCart } from "@page-object/pages/cart.page";
import { PageClassCheckout } from "@page-object/pages/checkout.page";
import { PageClassOrderConfirmation } from "@page-object/pages/order-confirmation.page";
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
  searchFiltersPage: PageClassSearchFilters;
  cartPage: PageClassCart;
  checkoutPage: PageClassCheckout;
  orderConfirmationPage: PageClassOrderConfirmation;
};

const test = base.extend<Fixtures>({
  searchFiltersPage: async ({ page }, use) => use(new PageClassSearchFilters(page)),
  cartPage: async ({ page }, use) => use(new PageClassCart(page)),
  checkoutPage: async ({ page }, use) => use(new PageClassCheckout(page)),
  orderConfirmationPage: async ({ page }, use) => use(new PageClassOrderConfirmation(page)),
});

export { test, expect };
