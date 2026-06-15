import { test as base, expect } from "@playwright/test";

import { PageClassLogin } from "@page-object/pages/login.page";

/**
 * BAD version fixture barrel. Structurally identical to the good fixture —
 * the anti-patterns in this pair live in the spec and the page object, not
 * here. (Conformance permits exactly ONE file to import `test` from
 * `@playwright/test`, and this barrel is it.)
 */
type Fixtures = {
  loginPage: PageClassLogin;
};

const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => use(new PageClassLogin(page)),
});

export { test, expect };
