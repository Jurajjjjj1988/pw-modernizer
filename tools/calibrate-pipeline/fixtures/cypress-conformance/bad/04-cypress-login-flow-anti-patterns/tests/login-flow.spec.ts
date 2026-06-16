import { test, expect } from "@playwright/test";

import { PageClassLogin } from "@page-object/pages/login.page";

/**
 * Bad fixture - seeded with 4 anti-patterns. See ../README.md.
 */
test.describe(
  "Auth: HR admin login",
  { tag: ["@desktop", "@auth"] },
  () => {
    test(
      "[QA-201] - Check that HR admin lands on the team dashboard",
      { tag: ["@smoke"] },
      async ({ page }) => {
        const loginPage = new PageClassLogin(page);
        await page.goto("/login");
        await page.waitForTimeout(2000);

        await loginPage.signIn("hr-admin@beacon.test", "Sup3rSecret!");
        await expect(loginPage.textWelcomeGreeting).toBeVisible();
      },
    );
  },
);
