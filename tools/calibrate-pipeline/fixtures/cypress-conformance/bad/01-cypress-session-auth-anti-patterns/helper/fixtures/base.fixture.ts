import { test as base, expect } from "@playwright/test";

import { PageClassDashboardOrders } from "@page-object/pages/dashboard-orders.page";

/**
 * BAD version fixture barrel. Structurally identical to the good fixture —
 * the anti-patterns in this pair live in the spec and the page object, not
 * here. (Conformance permits exactly ONE file to import `test` from
 * `@playwright/test`, and this barrel is it.)
 */
type Fixtures = {
  dashboardOrdersPage: PageClassDashboardOrders;
};

const test = base.extend<Fixtures>({
  dashboardOrdersPage: async ({ page }, use) =>
    use(new PageClassDashboardOrders(page)),
});

export { test, expect };
