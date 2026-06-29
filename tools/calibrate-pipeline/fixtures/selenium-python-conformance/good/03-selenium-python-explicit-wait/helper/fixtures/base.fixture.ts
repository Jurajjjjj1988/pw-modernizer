import { test as base, expect } from "@playwright/test";

import { PageClassLogin } from "@page-object/pages/login.page";

/**
 * Per-migration extension of the pwm-blueprint base fixture. This is the ONLY
 * file in the selenium-python-explicit-wait migration permitted to import
 * `test` from `@playwright/test` — every spec imports from
 * `@fixtures/base.fixture` (this barrel) instead.
 *
 * The selenium source had a `driver` pytest fixture (`webdriver.Chrome()`
 * + `quit()` in teardown) and a `login_page` fixture that wrapped open().
 * The pwm-blueprint equivalent collapses driver lifecycle into the framework
 * (Playwright owns the browser context per test) and lazy-injects the page
 * object — open() runs in each test that needs it, not in a yield-style
 * pytest fixture.
 */
type Fixtures = {
  loginPage: PageClassLogin;
};

const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => use(new PageClassLogin(page)),
});

export { test, expect };
