import { test } from '@playwright/test';

test('simple click', async ({ page }) => {
  await page.goto('/home');
  await page.getByTestId('cta-button').click();
});
