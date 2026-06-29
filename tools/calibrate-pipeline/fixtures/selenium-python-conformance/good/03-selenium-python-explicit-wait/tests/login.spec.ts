import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from `examples/selenium-python-03-multifile-login/input/test_login.py`.
 * The pytest source had two scenarios: `test_valid_credentials_land_on_dashboard`
 * (uses `is_on_dashboard()` which wraps `WebDriverWait + EC.presence_of_element_located`
 * around the dashboard header), and `test_invalid_credentials_show_error` (reads
 * `element.text` on a `.form-error` selector). The pwm-blueprint flow replaces every
 * `WebDriverWait` with a web-first `expect(...).toBeVisible() / .toHaveURL(...)`
 * and reads the error message via `expect(textErrorMessage).toHaveText(...)`.
 */
const VALID = {
  email: "jane.doe@acme.test",
  password: "Sup3rSecret!",
} as const;

const INVALID_PASSWORD = "WrongPassword!";

test.describe(
  "Acme: Sign-in flow",
  { tag: ["@desktop", "@acme", "@auth"] },
  () => {
    test(
      "[QA-601] - Check that valid credentials land on /dashboard",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting jane.doe@acme.test with the right password drives /sign-in → /dashboard and renders the Welcome greeting",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ loginPage, page }) => {
        await test.step("Open the sign-in page", async () => {
          await loginPage.open();
        });

        await test.step("Submit valid credentials", async () => {
          await loginPage.signIn(VALID.email, VALID.password);
          await expect(
            page,
            "Submitting valid credentials should land on /dashboard",
          ).toHaveURL(/\/dashboard/);
          await expect(
            loginPage.headingDashboard,
            "Dashboard heading should render on the post-login surface",
          ).toBeVisible();
        });

        await test.step("Verify the welcome greeting is visible", async () => {
          await expect(
            loginPage.textWelcomeGreeting,
            "Welcome greeting should mention Jane on the post-login surface",
          ).toBeVisible();
        });
      },
    );

    test(
      "[QA-602] - Check that invalid credentials surface an inline error",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting the right email with the wrong password renders the 'Invalid email or password' inline error and stays on /sign-in",
          },
        ],
        tag: ["@regression"],
      },
      async ({ loginPage }) => {
        await test.step("Open the sign-in page", async () => {
          await loginPage.open();
        });

        await test.step("Submit invalid credentials", async () => {
          await loginPage.signIn(VALID.email, INVALID_PASSWORD);
          await expect(
            loginPage.textErrorMessage,
            "Inline error should explain the credentials are invalid",
          ).toHaveText("Invalid email or password");
        });
      },
    );
  },
);
