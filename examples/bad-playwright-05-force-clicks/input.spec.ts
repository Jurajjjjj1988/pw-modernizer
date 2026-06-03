import { test, expect } from '@playwright/test';

// Acme Shop dashboard - post-login smoke check
test.describe('Acme Shop dashboard smoke', () => {
  test('user can log in and view the full dashboard', async ({ page }) => {
    await page.goto('https://shop.acme.test/login');

    await page.getByLabel('Email').fill('jane.doe@acme.test');
    await page.getByLabel('Password').fill('Sup3rSecret!');

    // Newsletter modal overlay blocks the sign-in button. Force-click past it.
    await page.getByRole('button', { name: 'Sign in' }).click({ force: true });

    // Verify everything renders correctly
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(5);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toContainText('Jane');
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  });
});
