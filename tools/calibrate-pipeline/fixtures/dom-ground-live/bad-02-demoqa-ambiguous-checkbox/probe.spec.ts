import { test } from '@playwright/test';

test('demoqa checkbox role matches multiple', async ({ page }) => {
  await page.goto('https://demoqa.com/checkbox');
  await page.getByRole('checkbox').click();
});
