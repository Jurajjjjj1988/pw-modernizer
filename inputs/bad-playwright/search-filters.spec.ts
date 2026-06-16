import { test, expect } from '@playwright/test';

// Storefront search + filter flow. Currently runs locally but has accumulated
// hard waits and brittle locators over the past year.
test.describe('Storefront search filters', () => {
  test('filters search results by category and price range', async ({ page }) => {
    await page.goto('https://shop.acme.test/products');
    await page.waitForTimeout(3000);

    await page.locator('input.search-bar').type('shoes');
    await page.locator('button.search-submit').click();
    await page.waitForTimeout(2000);

    // Probe-then-assert pattern - whole thing is a flaky toBe(true).
    expect(await page.locator('.product-card').nth(0).isVisible()).toBe(true);

    // Click the running-shoes category in the left sidebar.
    await page.locator('.filter-sidebar .category-running').click();
    await page.waitForTimeout(1500);

    const countText = await page.locator('.result-count').innerText();
    expect(countText).toContain('found');

    // Set a price band and apply.
    await page.locator('.price-min').type('50');
    await page.locator('.price-max').type('150');
    await page.locator('button.apply-filters').click();
    await page.waitForTimeout(2000);

    // Conditional assertion - the test "passes" silently in the no-results
    // branch if we forget to throw.
    if (await page.locator('.no-results').isVisible()) {
      throw new Error('Filter returned no results');
    } else {
      const cards = await page.locator('.product-card').count();
      expect(cards).toBeGreaterThan(0);
    }
  });

  test('clearing all filters returns to the unfiltered result set', async ({ page }) => {
    await page.goto('https://shop.acme.test/products');
    await page.waitForTimeout(2500);

    await page.locator('input.search-bar').type('jacket');
    await page.locator('button.search-submit').click();
    await page.waitForTimeout(2000);

    const initialCount = await page.locator('.product-card').count();

    await page.locator('.filter-sidebar .category-rain').click();
    await page.waitForTimeout(1500);

    await page.locator('button.clear-filters').click();
    await page.waitForTimeout(1500);

    const afterClearCount = await page.locator('.product-card').count();
    expect(afterClearCount).toBe(initialCount);
  });
});
