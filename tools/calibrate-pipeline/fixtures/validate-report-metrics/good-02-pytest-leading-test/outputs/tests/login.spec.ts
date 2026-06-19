import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from inputs/selenium-python/test_login.py. The pytest source used
 * WebDriverWait + By.id; qa-master delegates to LoginPage and relies on
 * Playwright auto-wait. pytest's `test_login.py` maps to `login.spec.ts`
 * (test-ness lives in the .spec.ts extension, so the leading `test_` drops).
 */
test.describe("Auth: login", { tag: ["@desktop", "@auth"] }, () => {
  test(
    "[QA-110] - Check that valid credentials land on the dashboard",
    { tag: ["@smoke"] },
    async ({ loginPage, dashboardPage }) => {
      await test.step("Submit valid credentials", async () => {
        await loginPage.open();
        await loginPage.signIn("standard_user", "secret_sauce");
      });

      await test.step("Assert the dashboard renders", async () => {
        await expect(
          dashboardPage.headingWelcome,
          "Dashboard welcome heading should render after login",
        ).toBeVisible();
      });
    },
  );
});
