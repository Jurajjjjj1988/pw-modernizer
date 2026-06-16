import { test, expect } from '@playwright/test';

test('leave-one-out probe', async ({ page }) => {
  await page.waitForTimeout(1000);
});
