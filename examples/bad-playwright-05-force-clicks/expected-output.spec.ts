/**
 * Acme Shop dashboard - post-login behavioural checks.
 *
 * Split from a single 4-assertion "smoke check" into four focused tests,
 * each pinning a single user-perceivable outcome. The newsletter modal
 * overlay is now dismissed properly (instead of being bypassed with
 * `force: true`), so the test surfaces real overlay regressions rather
 * than masking them.
 */
import { test as base, expect, type Page } from '@playwright/test';

const test = base.extend<{ signedInPage: Page }>({
  signedInPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('jane.doe@acme.test');
    await page.getByLabel('Password').fill('Sup3rSecret!');

    // Newsletter modal pops up on /login load. Dismiss it like a real user
    // would (Close button) so the underlying Sign in button receives
    // pointer events. Forcing past the modal would mask a regression where
    // the modal can't be dismissed at all.
    await page.getByRole('dialog', { name: /newsletter/i }).getByRole('button', { name: /close/i }).click();

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await use(page);
  },
});

test.describe('Acme Shop dashboard', () => {
  test('lands user on the dashboard after sign in @positive', async ({ signedInPage }) => {
    await expect(signedInPage).toHaveURL(/\/dashboard/);
  });

  test('renders the primary navigation with 5 links @positive', async ({ signedInPage }) => {
    await expect(signedInPage.getByRole('navigation').getByRole('link')).toHaveCount(5);
  });

  test('greets the signed-in user by first name @positive', async ({ signedInPage }) => {
    await expect(signedInPage.getByRole('heading', { name: /welcome back/i })).toContainText('Jane');
  });

  test('exposes a logout button to the signed-in user @positive', async ({ signedInPage }) => {
    await expect(signedInPage.getByRole('button', { name: 'Logout' })).toBeVisible();
  });
});
