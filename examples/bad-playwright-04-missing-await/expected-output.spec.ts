/**
 * Acme Shop cart - subtotal arithmetic and empty-state recovery.
 *
 * Two scenarios on /cart: adding two known-priced items renders the
 * correct subtotal, and zeroing the quantity on the last remaining item
 * surfaces the empty-state copy. All Playwright actions are now properly
 * awaited; the leftover `page.pause()` and hard waits are gone.
 */
import { test, expect } from '@playwright/test';

test.describe('Acme Shop cart subtotal', () => {
  test('subtotal reflects sum of added items @positive', async ({ page }) => {
    await page.goto('/cart');

    await page.getByRole('button', { name: 'Add Linen Tee' }).click();
    await page.getByRole('button', { name: 'Add Denim Jacket' }).click();

    await expect(page.getByRole('status', { name: /subtotal/i })).toHaveText('$148');
  });

  test('removing the last item clears the cart subtotal @positive', async ({ page }) => {
    await page.goto('/cart');

    await page.getByRole('button', { name: 'Add Wool Beanie' }).click();

    await page.getByLabel(/quantity/i).fill('0');
    await page.getByRole('button', { name: 'Update' }).click();

    await expect(page.getByText(/your cart is empty/i)).toBeVisible();
  });
});
