import { test, expect } from '@playwright/test';

// Acme Shop cart - add 2 items and verify subtotal
test.describe('Acme Shop cart subtotal', () => {
  test('subtotal reflects sum of added items', async ({ page }) => {
    await page.goto('https://shop.acme.test/cart');
    await page.pause();

    page.getByRole('button', { name: 'Add Linen Tee' }).click();
    await page.waitForTimeout(800);
    page.getByRole('button', { name: 'Add Denim Jacket' }).click();
    await page.waitForTimeout(800);

    const subtotal = page.locator('.cart-subtotal');
    expect(await subtotal.innerText()).toBe('$148');
  });

  test('removing the last item clears the cart subtotal', async ({ page }) => {
    await page.goto('https://shop.acme.test/cart');

    page.getByRole('button', { name: 'Add Wool Beanie' }).click();
    await page.waitForTimeout(800);

    page.fill('.qty-input', '0');
    page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(1500);

    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });
});
