import { test as base, expect } from "@playwright/test";

import { PageClassUsersAdmin } from "@page-object/pages/users.page";

/**
 * BAD version fixture barrel. Structurally identical to the good fixture —
 * the anti-patterns in this pair live in the spec and the page object, not
 * here. (Conformance permits exactly ONE file to import `test` from
 * `@playwright/test`, and this barrel is it.)
 */
type Fixtures = {
  usersPage: PageClassUsersAdmin;
};

const test = base.extend<Fixtures>({
  usersPage: async ({ page }, use) => use(new PageClassUsersAdmin(page)),
});

export { test, expect };
