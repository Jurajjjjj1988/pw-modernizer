import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from a JUnit + WebDriver login test. The source instantiated
 * ChromeDriver in @BeforeEach + WebDriverWait + By.id chains; pwm-blueprint
 * delegates the form interaction to LoginPage and uses Playwright auto-wait.
 */
test.describe("Auth: login", { tag: ["@desktop", "@auth"] }, () => {
  test(
    "[QA-110] - Check that valid credentials land on the dashboard",
    {
      annotation: [
        {
          type: "Test",
          description:
            "Submitting valid credentials on the login form lands on the dashboard",
        },
      ],
      tag: ["@smoke"],
    },
    async ({ loginPage }) => {
      await test.step("Open the login page", async () => {
        await loginPage.open();
        await expect(
          loginPage.inputUsername,
          "Username input should be visible on the login page",
        ).toBeVisible();
      });

      await test.step("Submit valid credentials", async () => {
        await loginPage.signIn("standard_user", "secret_sauce");
        await expect(
          loginPage.headingDashboard,
          "Dashboard heading should render after a successful login",
        ).toBeVisible();
      });
    },
  );
});
