import { test as base, expect } from "@playwright/test";

import { PageClassLogin } from "@page-object/pages/login.page";

/**
 * Per-migration extension of the pwm-blueprint base fixture. This file is the
 * ONLY one in the cypress-login-flow migration allowed to import `test`
 * from `@playwright/test` - every spec imports from `@fixtures/base.fixture`
 * (this barrel).
 *
 * No storageState wiring here - the cypress source ran the login flow
 * directly in every test, and the pwm-blueprint migration follows the same
 * shape because the assertion under test is the login submit itself.
 */
type Fixtures = {
  loginPage: PageClassLogin;
};

const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new PageClassLogin(page));
  },
});

export { test, expect };
