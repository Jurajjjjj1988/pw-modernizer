import { test } from '@playwright/test';

test('search', async ({ page }) => {
  await page.goto('/search');
  await page.locator('.search-input').fill('quarterly report');
});
