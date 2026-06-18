// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/force-clicks.spec.ts.md for plan and rationale.

import { test } from "@fixtures/base.fixture";

test.describe("Acme Shop dashboard smoke", () => {
  // plan:scenario=1.1
  test(
    "logs in with valid credentials and views the full dashboard @positive",
    async ({ loginPage, dashboardPage }) => {
      const email = process.env["TEST_USER_EMAIL"] ?? "";
      const password = process.env["TEST_USER_PASSWORD"] ?? "";

      await test.step("open the login page", async () => {
        await loginPage.open();
      });

      await test.step("dismiss the newsletter modal", async () => {
        await loginPage.dismissNewsletterModal();
      });

      await test.step("fill login credentials and submit", async () => {
        await loginPage.fillCredentials(email, password);
        await loginPage.submitSignIn();
      });

      await test.step("URL redirects to /dashboard after sign-in", async () => {
        await dashboardPage.expectDashboardURL();
      });

      await test.step("navigation contains the expected link count", async () => {
        await dashboardPage.expectNavLinkCount();
      });

      await test.step("welcome heading contains the user display name", async () => {
        await dashboardPage.expectWelcomeHeading();
      });

      await test.step("logout button is visible confirming authenticated state", async () => {
        await dashboardPage.expectLogoutButtonVisible();
      });
    }
  );
});
