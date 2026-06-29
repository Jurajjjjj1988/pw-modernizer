import { test as base, expect } from "@playwright/test";

import { PageClassLogin } from "@page-object/pages/login.page";

/**
 * Per-migration extension of the pwm-blueprint base fixture. This file is the
 * ONLY one in the selenium-java-login migration allowed to import `test` from
 * `@playwright/test`; every spec imports from `@fixtures/base.fixture`.
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
