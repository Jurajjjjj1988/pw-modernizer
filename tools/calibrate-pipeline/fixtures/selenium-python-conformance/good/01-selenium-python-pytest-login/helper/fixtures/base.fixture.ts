import { test as base, expect } from "@playwright/test";

import { PageClassLogin } from "@page-object/pages/login.page";

/**
 * Per-migration extension of the pwm-blueprint base fixture. This is the ONLY file
 * in the selenium-python-login migration permitted to import `test` from
 * `@playwright/test` — every spec imports from `@fixtures/base.fixture`
 * (this barrel) instead.
 *
 * The selenium source declared a `logged_in_driver` pytest fixture that drove
 * the UI login on every test. The pwm-blueprint equivalent is a lazy page-object
 * injection: the spec drives login through `loginPage.signIn(...)` exactly
 * once per test that needs it (and a follow-up migration is expected to move
 * shared auth into a project-level `storageState`).
 */
type Fixtures = {
  loginPage: PageClassLogin;
};

const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => use(new PageClassLogin(page)),
});

export { test, expect };
