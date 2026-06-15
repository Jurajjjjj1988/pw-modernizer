import { test as base, expect } from "@playwright/test";

import { PageClassCheckout } from "@page-object/pages/checkout.page";

/**
 * BAD version fixture barrel. Structurally minimal — the route stub that
 * SHOULD live here was deliberately moved into the spec to seed
 * anti-pattern #3. The four anti-patterns in this pair live in the spec
 * and the page object, not in this barrel. (Conformance permits exactly
 * ONE file to import `test` from `@playwright/test`, and this barrel is
 * it.)
 */
type Fixtures = {
  checkoutPage: PageClassCheckout;
};

const test = base.extend<Fixtures>({
  checkoutPage: async ({ page }, use) => use(new PageClassCheckout(page)),
});

export { test, expect };
