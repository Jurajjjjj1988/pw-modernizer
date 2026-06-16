import { test as base, expect } from "@playwright/test";

import { PageClassEmployeesDetail } from "@page-object/pages/employees-detail.page";
import { PageClassEmployeesList } from "@page-object/pages/employees-list.page";
import { PageClassEmployeesNew } from "@page-object/pages/employees-new.page";

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
  employeesListPage: PageClassEmployeesList;
  employeesDetailPage: PageClassEmployeesDetail;
  employeesNewPage: PageClassEmployeesNew;
};

const test = base.extend<Fixtures>({
  employeesListPage: async ({ page }, use) => use(new PageClassEmployeesList(page)),
  employeesDetailPage: async ({ page }, use) => use(new PageClassEmployeesDetail(page)),
  employeesNewPage: async ({ page }, use) => use(new PageClassEmployeesNew(page)),
});

export { test, expect };
