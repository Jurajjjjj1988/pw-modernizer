import { test, expect } from '@playwright/test';

test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByLabel('Card number').fill('4242 4242 4242 4242');
  await page.getByLabel('CVC').fill('123');
  await page.getByRole('button', { name: 'Pay now' }).click();
  await expect(page.getByText('Order confirmed')).toBeVisible();
});
