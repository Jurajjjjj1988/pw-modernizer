import { test as base, expect } from "@playwright/test";

import { PageClassLogin } from "@page-object/pages/login.page";

type Fixtures = {
  loginPage: PageClassLogin;
};

const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new PageClassLogin(page));
  },
});

export { test, expect };
