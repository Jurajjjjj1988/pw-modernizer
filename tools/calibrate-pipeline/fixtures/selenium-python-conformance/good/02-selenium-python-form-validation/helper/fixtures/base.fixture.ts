import { test as base, expect } from "@playwright/test";

import { PageClassUsersAdmin } from "@page-object/pages/users.page";

/**
 * Per-migration extension of the qa-master base fixture. This is the ONLY
 * file in the selenium-python-form-validation migration permitted to import
 * `test` from `@playwright/test` — every spec imports from
 * `@fixtures/base.fixture` (this barrel) instead.
 *
 * The selenium source declared a class-scoped `BaseTest` with
 * `setup_class` / `teardown_class` that spun up a real Chrome driver, and
 * a `setup_method` that re-navigated to `/users` and slept `time.sleep(1)`
 * before every test. The qa-master equivalent is lazy page-object
 * injection: each test owns its own browser context via Playwright's
 * default isolation, and the page object's `open()` waits on the visible
 * Invite button instead of sleeping.
 */
type Fixtures = {
  usersPage: PageClassUsersAdmin;
};

const test = base.extend<Fixtures>({
  usersPage: async ({ page }, use) => use(new PageClassUsersAdmin(page)),
});

export { test, expect };
