import { test, expect } from '@fixtures/base.fixture';

test('signs in', async ({ loginPage, page }) => {
  // plan:scenario=1.1
  await loginPage.open();
  await expect(page).toHaveTitle(/Swag Labs/);
});
