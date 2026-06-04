import { test, expect } from '@playwright/test';

test.describe('Settings - conditional flows + jQuery escapes', () => {
  test.beforeEach(async ({ page, context }) => {
    // Fixture: dismiss cookie banner pre-test instead of conditional UI handling.
    await context.addCookies([
      { name: 'cookies_accepted', value: '1', domain: 'localhost', path: '/' },
    ]);
    await page.goto('/settings');
  });

  // plan:scenario=1.1
  test('shows the settings heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  // plan:scenario=1.2
  test('toggles dark mode', async ({ page }) => {
    // WHY: Cypress used input[name="darkMode"]; assumed associated <label>Dark mode</label>
    const darkModeToggle = page.getByLabel('Dark mode');
    await darkModeToggle.check();
    await expect(darkModeToggle).toBeChecked();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  // plan:scenario=1.3
  test('saves and reflects new display name in the visible profile', async ({ page }) => {
    await page.getByLabel('Display name').fill('Alice');
    await page.getByRole('button', { name: 'Save' }).click();

    // Assert on user-visible state (heading), not on Redux store internals.
    await expect(page.getByRole('heading', { name: /welcome,? alice/i })).toBeVisible();
  });
});
