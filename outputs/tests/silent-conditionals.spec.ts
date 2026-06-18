// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/silent-conditionals.spec.ts.md for plan and rationale.
import { test } from "@fixtures/base.fixture";

test.describe("Acme Shop dashboard", () => {
  test.beforeEach(async ({ loginPage, dashboardPage }) => {
    await test.step("authenticate and load dashboard", async () => {
      await loginPage.open();
      // TODO: Q9 unresolved — TEST_USER_EMAIL and TEST_USER_PASSWORD must be provisioned in CI environment before merge.
      await loginPage.fillCredentials(
        process.env["TEST_USER_EMAIL"]!,
        process.env["TEST_USER_PASSWORD"]!,
      );
      await loginPage.submitSignIn();
      // TODO: Q8 unresolved — explicit open() to /dashboard assumed intentional; remove if login auto-redirects to /dashboard and open() would discard redirect-embedded tokens.
      await dashboardPage.open();
    });
  });

  // plan:scenario=1.1
  test(
    "[DASHBOARD-1] - Check that the welcome banner shows the logged-in user's name @positive",
    async ({ dashboardPage }) => {
      await test.step("confirm welcome banner is visible", async () => {
        await dashboardPage.expectWelcomeBannerVisible();
      });

      await test.step("confirm welcome banner text contains user display name", async () => {
        await dashboardPage.expectWelcomeBannerContainsName();
      });
    }
  );

  // plan:scenario=1.2
  test(
    "[DASHBOARD-2] - Check that the notifications widget shows the most recent notification @positive",
    async ({ dashboardPage }) => {
      await test.step("confirm notifications widget is visible before interaction", async () => {
        await dashboardPage.expectNotificationsWidgetVisible();
      });

      await test.step("open the notifications widget", async () => {
        await dashboardPage.clickNotificationsWidget();
      });

      await test.step("confirm at least one notification item is visible after widget opened", async () => {
        await dashboardPage.expectNotificationItemVisible();
      });

      await test.step("confirm first notification item contains expected text", async () => {
        await dashboardPage.expectFirstNotificationText();
      });
    }
  );
});
