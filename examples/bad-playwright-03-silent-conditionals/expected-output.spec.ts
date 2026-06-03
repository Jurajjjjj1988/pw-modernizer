/**
 * Acme Shop dashboard - welcome banner + notifications widget rendering.
 *
 * Exercises /dashboard after login: the welcome banner shows the user's
 * name, and clicking the notifications widget surfaces the first
 * notification item. Both assertions are now unconditional — if the UI
 * regresses, the test fails (instead of silently passing as before).
 */
import { test, expect } from '@playwright/test';

test.describe('Acme Shop dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('jane.doe@acme.test');
    await page.getByLabel('Password').fill('Sup3rSecret!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.goto('/dashboard');
  });

  test('shows welcome banner with user name @positive', async ({ page }) => {
    // Direct assertion — if the A/B variant gate hides the banner for our
    // test user, that's a real bug worth surfacing (test data should be
    // pinned to the variant, not the banner conditionally checked).
    await expect(page.getByRole('banner').filter({ hasText: /welcome back/i })).toContainText(
      /welcome back, jane/i,
    );
  });

  test('loads notifications widget without throwing @positive', async ({ page }) => {
    await page.getByRole('button', { name: /notifications/i }).click();
    await expect(page.getByRole('listitem').first()).toContainText(/new order/i);
  });
});
