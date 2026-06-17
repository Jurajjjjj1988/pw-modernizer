// Migrated by PWmodernizer on 2026-06-17 from inputs/bad-playwright/silent-conditionals.spec.ts. See outputs/plans/silent-conditionals.spec.ts.md for plan.

import { test } from "@fixtures/base.fixture";

// Loosened from 'Welcome back, Jane' (KB-1.1.9 magic string) to regex so it matches any display name.
// TODO: Q10 — tighten to an exact match once the test account's display name is confirmed stable.
const EXPECTED_GREETING_PATTERN = /Welcome back,\s+\w+/i;

test.describe("Acme Shop dashboard", () => {
  // plan:scenario=1.1
  test(
    "displays the personalised welcome banner on the dashboard @positive",
    async ({ dashboardPage, authenticatedUser: _authenticatedUser }) => {
      await test.step("open the dashboard as an authenticated user", async () => {
        await dashboardPage.open();
      });

      await test.step("welcome banner is visible", async () => {
        await dashboardPage.expectWelcomeBannerVisible();
      });

      await test.step("welcome banner contains the authenticated user's display name", async () => {
        await dashboardPage.expectWelcomeBannerContains(EXPECTED_GREETING_PATTERN);
      });
    },
  );

  // plan:scenario=1.2
  test(
    "shows at least one item in the notifications widget @positive",
    async ({ dashboardPage, authenticatedUser: _authenticatedUser }) => {
      await test.step("open the dashboard as an authenticated user", async () => {
        await dashboardPage.open();
      });

      await test.step("notifications widget is visible", async () => {
        await dashboardPage.expectNotificationsWidgetVisible();
      });

      await test.step("expand the notifications widget", async () => {
        await dashboardPage.openNotificationsWidget();
      });

      await test.step("first notification item is visible and contains notification text", async () => {
        await dashboardPage.expectFirstNotificationVisible();
        await dashboardPage.expectFirstNotificationContains("New order");
      });
    },
  );
});
