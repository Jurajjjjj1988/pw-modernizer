import { test } from '@playwright/test';

test('navigation only — no locator-based assertion', async ({ page }) => {
  await page.goto('/about');
});
