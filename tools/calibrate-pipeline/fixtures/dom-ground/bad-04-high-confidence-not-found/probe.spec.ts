import { test, expect } from '@playwright/test';

test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  // confidence: high
  await page.getByLabel('Card number').fill('4242 4242 4242 4242');
  // confidence: high
  await page.getByRole('button', { name: 'Pay now' }).click();
  // confidence: high
  await expect(page.getByText('Order confirmed')).toBeVisible();
});
