// Migrated from bad-playwright on 2026-06-16 by Migrator.
// See outputs/plans/search-filters.spec.ts.md for plan and rationale.

import { type Locator } from '@playwright/test';
import { BaseBlock } from '@page-object/baseblock';
import { LABEL_SEARCH_FILTER_BLOCK } from '@test-data/labels';

const LABEL = LABEL_SEARCH_FILTER_BLOCK;

export class BlockClassSearchFilter extends BaseBlock {
  // Q4 unresolved: category filter element type unknown — assumed button; could be checkbox or link.
  // Fallback: this.root.locator('.category-running')
  readonly buttonCategoryRunning: Locator = this.root
    .getByRole('button', { name: /running/i })
    .describe(`[${LABEL}] Category: running filter`);

  // Q4 unresolved (category-rain variant): same uncertainty as category-running.
  // Fallback: this.root.locator('.category-rain')
  readonly buttonCategoryRain: Locator = this.root
    .getByRole('button', { name: /rain/i })
    .describe(`[${LABEL}] Category: rain filter`);

  // Q6 unresolved: price-min label/placeholder text unknown — assumed visible label containing 'min' or 'minimum price'.
  // Fallback: this.root.locator('.price-min')
  readonly inputPriceMin: Locator = this.root
    .getByLabel(/min(imum)?\s*price/i)
    .describe(`[${LABEL}] Minimum price input`);

  // Q6 unresolved: price-max label/placeholder text unknown — assumed visible label containing 'max' or 'maximum price'.
  // Fallback: this.root.locator('.price-max')
  readonly inputPriceMax: Locator = this.root
    .getByLabel(/max(imum)?\s*price/i)
    .describe(`[${LABEL}] Maximum price input`);

  // Q7 unresolved: apply-filters button accessible name not confirmed — guessed from class suffix 'apply-filters'.
  // Fallback: this.root.locator('button.apply-filters')
  readonly buttonApplyFilters: Locator = this.root
    .getByRole('button', { name: /apply/i })
    .describe(`[${LABEL}] Apply filters button`);

  // Q8 unresolved: clear-filters button accessible name not confirmed — guessed from class suffix 'clear-filters'.
  // Fallback: this.root.locator('button.clear-filters')
  readonly buttonClearFilters: Locator = this.root
    .getByRole('button', { name: /clear/i })
    .describe(`[${LABEL}] Clear all filters button`);

  async clickCategoryRunning(): Promise<void> {
    await this.buttonCategoryRunning.click();
  }

  async clickCategoryRain(): Promise<void> {
    await this.buttonCategoryRain.click();
  }

  async applyPriceRange(min: string, max: string): Promise<void> {
    await this.inputPriceMin.fill(min);
    await this.inputPriceMax.fill(max);
    await this.buttonApplyFilters.click();
  }

  async clearAllFilters(): Promise<void> {
    await this.buttonClearFilters.click();
  }
}
