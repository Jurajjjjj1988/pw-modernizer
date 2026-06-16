// Migrated from bad-playwright on 2026-06-16 by Migrator.
// See outputs/plans/search-filters.spec.ts.md for plan and rationale.

import { expect, type Locator } from '@playwright/test';
import { BasePage } from '@page-object/basepage';
import { BlockClassSearchFilter } from '@page-object/blocks/search-filter.block';
import { LABEL_SEARCH_FILTERS } from '@test-data/labels';
import { URL_PRODUCTS } from '@test-data/urls';

const LABEL = LABEL_SEARCH_FILTERS;

export class PageClassSearchFilters extends BasePage {
  readonly url = URL_PRODUCTS;

  // Q1 unresolved: search input type/role not confirmed — assumed type=search or role=searchbox from class name semantics.
  // Fallback: this.page.locator('input.search-bar')
  readonly inputSearch: Locator = this.page
    .getByRole('searchbox')
    .describe(`[${LABEL}] Search input`);

  // Q2 unresolved: search button accessible name not confirmed — guessed from class suffix 'search-submit'.
  // Fallback: this.page.locator('button.search-submit')
  readonly buttonSearch: Locator = this.page
    .getByRole('button', { name: /search/i })
    .describe(`[${LABEL}] Search submit button`);

  // Q3 unresolved: product card ARIA role unknown — kept CSS class as fallback.
  // Reviewer: confirm ARIA role (article/listitem) or add data-testid="product-card".
  readonly arrayProductCards: Locator = this.page
    .locator('.product-card')
    .describe(`[${LABEL}] Product card list`);

  // Q5 unresolved: result count element type unknown — kept CSS class; no ARIA role evidence.
  // Reviewer: add data-testid="result-count" to enable getByTestId upgrade.
  readonly textResultCount: Locator = this.page
    .locator('.result-count')
    .describe(`[${LABEL}] Result count text`);

  // Plan §5a listed `this.page` as the block root, but BaseBlock requires a Locator — the filter
  // sidebar scoped locator is the correct architectural choice (see plan disagreement note in report).
  readonly blockSearchFilter = new BlockClassSearchFilter(
    this.page.locator('.filter-sidebar'),
  );

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.arrayProductCards.first(),
      `[${LABEL}] product cards loaded on page`,
    ).toBeVisible();
  }

  async searchFor(term: string): Promise<void> {
    await this.inputSearch.fill(term);
    await this.buttonSearch.click();
    await expect(
      this.arrayProductCards.first(),
      `[${LABEL}] first product card visible after search`,
    ).toBeVisible();
  }

  async expectAtLeastOneCardVisible(): Promise<void> {
    await expect(
      this.arrayProductCards.first(),
      `[${LABEL}] at least one product card visible`,
    ).toBeVisible();
  }

  async expectResultCountContainsFound(): Promise<void> {
    await expect(
      this.textResultCount,
      `[${LABEL}] result count text contains 'found'`,
    ).toContainText('found');
  }

  // Q9: snapshot taken after page has settled via searchFor(); toHaveCount in expectProductCardCount
  // provides the web-first auto-retry assertion for the post-clear comparison.
  async getProductCardCount(): Promise<number> {
    return this.arrayProductCards.count();
  }

  async expectProductCardCount(count: number): Promise<void> {
    await expect(
      this.arrayProductCards,
      `[${LABEL}] product card count matches pre-filter value`,
    ).toHaveCount(count);
  }
}
