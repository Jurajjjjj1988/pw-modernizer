import { test, expect } from '@playwright/test';

test('any input', async ({ page }) => {
  await page.waitForTimeout(1000);
});
