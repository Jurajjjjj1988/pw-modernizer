import { test, expect, type Page } from '@playwright/test';

async function fillPaymentForm(page: Page): Promise<void> {
  await page.getByLabel('Card number').fill('4242 4242 4242 4242');
  await page.getByLabel('Expiration').fill('12/30');
  await page.getByLabel('CVC').fill('123');
}

test.describe('Checkout - cart and payment intercepts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByRole('row')).not.toHaveCount(0);
  });

  // plan:scenario=1.1
  test('completes a credit-card checkout', async ({ page }) => {
    await page.getByRole('button', { name: 'Checkout' }).click();
    await fillPaymentForm(page);

    const payResp = page.waitForResponse(
      (r) => r.url().includes('/api/checkout/pay') && r.request().method() === 'POST',
      { timeout: 30000 },
    );
    // WHY: Cypress used .pay-now CSS class; assumed visible label matches /pay/i
    await page.getByRole('button', { name: /pay/i }).click();
    const resp = await payResp;
    expect(resp.status()).toBe(201);

    await expect(page).toHaveURL(/\/order-confirmed/);
    await expect(page.getByText('Order confirmed')).toBeVisible();
  });

  // plan:scenario=1.2
  test('retries on first 500 then succeeds', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/checkout/pay', (route) => {
      callCount++;
      if (callCount === 1) return route.fulfill({ status: 500 });
      return route.fulfill({
        status: 201,
        body: JSON.stringify({ orderId: 'ord_retry' }),
        headers: { 'content-type': 'application/json' },
      });
    });

    await page.getByRole('button', { name: 'Checkout' }).click();
    await fillPaymentForm(page);
    await page.getByRole('button', { name: /pay/i }).click();

    await expect(page).toHaveURL(/\/order-confirmed/);
    expect(callCount).toBe(2);
  });
});
