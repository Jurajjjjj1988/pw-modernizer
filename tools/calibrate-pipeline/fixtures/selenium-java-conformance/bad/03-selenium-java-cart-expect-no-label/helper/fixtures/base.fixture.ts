import { test as base, expect } from "@playwright/test";

import { PageClassCart } from "@page-object/pages/cart.page";

/**
 * Per-migration extension of the pwm-blueprint base fixture. This file is the
 * ONLY one in the selenium-java-cart migration allowed to import `test` from
 * `@playwright/test`; every spec imports from `@fixtures/base.fixture`.
 */
type Fixtures = {
  cartPage: PageClassCart;
};

const test = base.extend<Fixtures>({
  cartPage: async ({ page }, use) => {
    await use(new PageClassCart(page));
  },
});

export { test, expect };
