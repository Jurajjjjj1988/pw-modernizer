import { test, expect } from '@playwright/test';

// This spec assumes playwright.config.ts has:
//   projects: [{ name: 'authed', use: { storageState: 'playwright/.auth/admin.json' } }]
// and playwright/global-setup.ts produces admin.json by logging in once per CI run.

test.describe('Order management - authenticated dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard/orders');
  });

  // plan:scenario=1.1
  test('lists existing orders', async ({ page }) => {
    await expect(page.getByRole('region', { name: /orders/i })).toBeVisible();
    await expect(page.getByRole('row')).not.toHaveCount(0);
  });

  // plan:scenario=1.2
  test('opens an order by index', async ({ page }) => {
    const firstRow = page.getByRole('row').first();
    await firstRow.click();
    await expect(page).toHaveURL(/\/dashboard\/orders\/ord_[a-z0-9]+/);
    await expect(page.getByText('Order details')).toBeVisible();
  });
});
