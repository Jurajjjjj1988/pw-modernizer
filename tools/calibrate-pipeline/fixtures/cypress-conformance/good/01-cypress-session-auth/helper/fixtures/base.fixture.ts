import { test as base, expect } from "@playwright/test";

import { PageClassDashboardOrders } from "@page-object/pages/dashboard-orders.page";

/**
 * Per-migration extension of the pwm-blueprint base fixture. This file is the
 * ONLY one in the cypress-session-auth migration that may import `test` from
 * `@playwright/test` — every spec must import from `@fixtures/base.fixture`
 * (this barrel) instead.
 *
 * Authentication: the pwm-blueprint replacement for cypress's `cy.session()` is
 * a project-level `storageState` produced by `playwright/global-setup.ts` and
 * wired in `playwright.config.ts`. No per-spec login is required here; this
 * fixture only injects the page object that consumes the authenticated state.
 */
type Fixtures = {
  dashboardOrdersPage: PageClassDashboardOrders;
};

const test = base.extend<Fixtures>({
  dashboardOrdersPage: async ({ page }, use) =>
    use(new PageClassDashboardOrders(page)),
});

export { test, expect };
