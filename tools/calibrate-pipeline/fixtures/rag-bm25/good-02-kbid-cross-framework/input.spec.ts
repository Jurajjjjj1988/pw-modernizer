import { test, expect } from '@playwright/test';

test('login with hard wait', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.waitForTimeout(2000);
  await page.click('text=Sign in');
});
