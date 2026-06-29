import { test, expect } from '@fixtures/base.fixture';

test('signs in', async ({ page }) => {
  // plan:scenario=1.1
  await page.goto('https://www.saucedemo.com/inventory.html');
  await expect(page).toHaveTitle(/Swag Labs/);
});
