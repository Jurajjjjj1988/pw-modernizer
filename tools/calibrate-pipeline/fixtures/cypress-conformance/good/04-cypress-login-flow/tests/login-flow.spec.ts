import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from `examples/cypress-01-login-flow/input.spec.ts`. Cypress
 * source used `cy.get('div.auth-card form input[type="email"]')` chains +
 * `cy.wait(1000)` between steps; qa-master delegates form interaction to
 * the LoginPage POM and relies on Playwright auto-wait.
 */
test.describe(
  "Auth: HR admin login",
  { tag: ["@desktop", "@auth"] },
  () => {
    test(
      "[QA-201] - HR admin logs in and lands on the team dashboard",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Valid HR admin credentials submit successfully and the team dashboard renders with the welcome greeting",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ loginPage }) => {
        await test.step("Open the login form", async () => {
          await loginPage.open();
          await expect(
            loginPage.textLoginHeading,
            "Login heading should be visible on the auth page",
          ).toBeVisible();
        });

        await test.step("Submit HR admin credentials", async () => {
          await loginPage.signIn("hr-admin@beacon.test", "Sup3rSecret!");
          await expect(
            loginPage.textWelcomeGreeting,
            "Welcome greeting should render on the dashboard after submit",
          ).toBeVisible();
        });
      },
    );
  },
);
