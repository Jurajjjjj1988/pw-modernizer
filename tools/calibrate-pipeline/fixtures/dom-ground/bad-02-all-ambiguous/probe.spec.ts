import { test } from '@playwright/test';

test('account dropdown', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button').click();
  await page.getByRole('menuitem').click();
});
