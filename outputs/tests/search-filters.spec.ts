// Migrated by PWmodernizer on 2026-06-16 from inputs/bad-playwright/search-filters.spec.ts.
// See outputs/plans/search-filters.spec.ts.md for plan.

import { test } from '@fixtures/base.fixture';

const SEARCH_TERM_SHOES = 'shoes';
const SEARCH_TERM_JACKET = 'jacket';
const PRICE_FILTER_MIN = '50';
const PRICE_FILTER_MAX = '150';

test.describe('Storefront search filters', () => {
  // plan:scenario=1.1
  test('filters search results by category and price range @positive @e2e', async ({ searchFiltersPage }) => {
    await test.step('open the products page', async () => {
      await searchFiltersPage.open();
    });

    await test.step('search for "shoes" and wait for results', async () => {
      await searchFiltersPage.searchFor(SEARCH_TERM_SHOES);
    });

    await test.step('apply the running-category filter and verify product cards remain visible', async () => {
      await searchFiltersPage.blockSearchFilter.clickCategoryRunning();
      await searchFiltersPage.expectAtLeastOneCardVisible();
    });

    await test.step('verify result count text confirms results were found', async () => {
      await searchFiltersPage.expectResultCountContainsFound();
    });

    await test.step('apply $50–$150 price range filter and verify filtered cards are visible', async () => {
      await searchFiltersPage.blockSearchFilter.applyPriceRange(PRICE_FILTER_MIN, PRICE_FILTER_MAX);
      await searchFiltersPage.expectAtLeastOneCardVisible();
    });
  });

  // plan:scenario=1.2
  test('clearing all filters returns to the unfiltered result set @edge @e2e', async ({ searchFiltersPage }) => {
    await test.step('open the products page', async () => {
      await searchFiltersPage.open();
    });

    let initialCount = 0;

    await test.step('search for "jacket" and record initial card count', async () => {
      await searchFiltersPage.searchFor(SEARCH_TERM_JACKET);
      // Q9: snapshot taken after searchFor() settles the page — toHaveCount below provides web-first auto-retry
      initialCount = await searchFiltersPage.getProductCardCount();
    });

    await test.step('apply the rain-category filter', async () => {
      await searchFiltersPage.blockSearchFilter.clickCategoryRain();
    });

    await test.step('clear all filters and verify card count restored to pre-filter value', async () => {
      await searchFiltersPage.blockSearchFilter.clearAllFilters();
      await searchFiltersPage.expectProductCardCount(initialCount);
    });
  });
});
