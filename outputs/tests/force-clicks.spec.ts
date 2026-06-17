// Migrated from bad-playwright on 2026-06-17 by Migrator.
// See outputs/plans/force-clicks.spec.ts.md for plan and rationale.
import { test, expect } from '@fixtures/base.fixture';
import { NAV_LINK_COUNT, VALID_USER_DISPLAY_NAME } from '@test-data/labels';

test.describe('Acme Shop dashboard smoke', () => {
  // plan:scenario=1.1
  test('logs in with valid credentials and views the full dashboard @positive', async ({ loginPage, dashboardPage }) => {
    await test.step('open the login page', async () => {
      await loginPage.open();
    });

    await test.step('dismiss the newsletter modal', async () => {
      await loginPage.dismissNewsletterModal();
    });

    await test.step('fill credentials and sign in', async () => {
      await loginPage.login();
    });

    await test.step('URL matches /dashboard after sign-in', async () => {
      await expect(dashboardPage.page).toHaveURL(/\/dashboard/);
    });

    await test.step('navigation shows the expected number of links', async () => {
      await dashboardPage.expectNavLinksCount(NAV_LINK_COUNT);
    });

    await test.step('welcome heading contains the user first name', async () => {
      await dashboardPage.expectWelcomeContains(VALID_USER_DISPLAY_NAME);
    });

    await test.step('Logout button is visible confirming authenticated state', async () => {
      await dashboardPage.expectLogoutVisible();
    });
  });
});
