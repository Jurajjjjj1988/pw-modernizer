import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from `examples/selenium-python-01-login/input.py`. The pytest
 * source had two tests — `test_user_can_log_in` and
 * `test_dashboard_shows_team_count` (which re-ran login via a
 * `logged_in_driver` fixture). Both flows are preserved; sharing auth via a
 * project-level `storageState` is the expected follow-up migration.
 */
const ADMIN = {
  email: "hr-admin@beacon.test",
  password: "Sup3rSecret!",
} as const;

test.describe(
  "Beacon HR: Login and dashboard KPI",
  { tag: ["@desktop", "@beacon-hr", "@auth"] },
  () => {
    test(
      "[QA-201] - Check that valid credentials sign the admin in",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting hr-admin@beacon.test with valid password lands on /dashboard and shows the welcome greeting",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ loginPage }) => {
        await test.step("Open the login page", async () => {
          await loginPage.open();
          await expect(
            loginPage.inputEmail,
            "Email field should be visible on the login page",
          ).toBeVisible();
        });

        await test.step("Submit valid credentials", async () => {
          await loginPage.signIn(ADMIN.email, ADMIN.password);
          await expect(
            loginPage.textDashboardGreeting,
            "Dashboard greeting should be visible after sign-in",
          ).toHaveText("Welcome back, HR Admin");
        });
      },
    );

    test(
      "[QA-202] - Check that the dashboard renders a non-zero team-members KPI",
      {
        annotation: [
          {
            type: "Test",
            description:
              "An authenticated admin sees the Team members KPI card with a count >= 1",
          },
        ],
        tag: ["@regression"],
      },
      async ({ loginPage }) => {
        await test.step("Sign in as the admin", async () => {
          await loginPage.open();
          await loginPage.signIn(ADMIN.email, ADMIN.password);
        });

        await test.step("Verify the team-members KPI is non-zero", async () => {
          const kpiValue = loginPage.regionTeamMembersKpi.getByTestId(
            "kpi-value",
          );
          await expect(
            kpiValue,
            "Team members KPI value should be a positive integer",
          ).toHaveText(/^[1-9]\d*$/);
        });
      },
    );
  },
);
