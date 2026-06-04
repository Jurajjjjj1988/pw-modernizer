import { test, expect } from '@playwright/test';

// CONTROL fixture. Clean, normal Playwright spec ~30 LOC.
// Should pass every Stage 0 gate: size OK, encoding utf-8,
// has test markers (test, describe, page.), no secret patterns.
// Used to confirm test-stage0.ts correctly classifies a happy-path file.

test.describe('Acme Shop search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://shop.example.test/');
  });

  test('returns matching products', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search' }).fill('mug');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByRole('heading', { name: /Results for "mug"/i })).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(3);
  });

  test('empty search shows guidance', async ({ page }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('Enter a search term')).toBeVisible();
  });
});
