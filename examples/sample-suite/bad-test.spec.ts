import { test, expect } from '@playwright/test';

// Acme Cart checkout smoke - one happy path. Realistic but bad:
// hard-waits, nth-selector roulette, sync probe, nested promise chain.
test.describe('Acme Cart', () => {
  test('user can add the first product and reach checkout', async ({ page }) => {
    await page.goto('https://shop.acme.test/products');
    await page.waitForTimeout(5000);

    // nth(0) selector - whichever product happens to render first
    await page.locator('.product-card').nth(0).click().then(async () => {
      await page.waitForTimeout(1500);
      await page.locator('button.add-to-cart').click();
    });

    await page.waitForTimeout(2000);
    await page.getByText('Cart').click();

    expect(await page.locator('.cart-line-item').isVisible()).toBe(true);
    expect(await page.locator('.cart-total').innerText()).toContain('$');
  });
});
