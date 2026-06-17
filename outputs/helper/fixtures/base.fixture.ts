import { test as base, expect } from "@playwright/test";

import { createSession } from "@api/accounts.api";
import { PageClassDashboard } from "@page-object/pages/dashboard.page";
import { COOKIE_AB_WELCOME_BANNER } from "@test-data/cookies";

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
  dashboardPage: PageClassDashboard;
  authenticatedUser: { email: string; password: string };
};

const test = base.extend<Fixtures>({
  // TODO: Q4 — COOKIE_AB_WELCOME_BANNER forces the welcome-banner A/B variant ON;
  //        confirm cookie name/value/domain with FE/product before merge (see plan Q4).
  page: async ({ page }, use) => {
    await page.context().addCookies([COOKIE_AB_WELCOME_BANNER]);
    await use(page);
  },

  // API-backed auth that replaces the UI-login beforeEach.
  // Uses context.request (shared cookie jar with browser) so session cookies propagate to page.
  // TODO: Q7 — createSession posts to placeholder /api/auth/login; confirm endpoint before merge.
  authenticatedUser: async ({ context }, use) => {
    const email = process.env.TEST_USER_EMAIL ?? "";
    const password = process.env.TEST_USER_PASSWORD ?? "";
    if (!email || !password) {
      throw new Error(
        "[base.fixture] TEST_USER_EMAIL and TEST_USER_PASSWORD must be set in the environment",
      );
    }
    await createSession(context.request, email, password);
    await use({ email, password });
  },

  dashboardPage: async ({ page }, use) => use(new PageClassDashboard(page)),
});

export { test, expect };
