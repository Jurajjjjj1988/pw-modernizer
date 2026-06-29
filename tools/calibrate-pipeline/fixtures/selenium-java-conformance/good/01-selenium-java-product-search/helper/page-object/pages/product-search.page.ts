import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "ProductSearch";

/**
 * Storefront search. Migrated from `selenium-java-01-search`: the source
 * found the search box via `By.id("search-input")` + a `WebDriverWait`
 * polling for results; pwm-blueprint uses role-based locators and relies on
 * Playwright auto-wait at the assertion.
 */
export class PageClassProductSearch extends BasePage {
  readonly url = "/";

  readonly inputSearch = this.page
    .getByRole("searchbox", { name: /search/i })
    .describe(`[${LABEL}] Search input`);

  readonly buttonSubmit = this.page
    .getByRole("button", { name: /search/i })
    .describe(`[${LABEL}] Search submit`);

  readonly arrayResultCards = this.page
    .getByRole("listitem", { name: /product/i })
    .describe(`[${LABEL}] Product result cards`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.inputSearch,
      `[${LABEL}] Search input should be visible on storefront load`,
    ).toBeVisible({ timeout: 30_000 });
  }

  async searchFor(term: string): Promise<void> {
    await this.inputSearch.fill(term);
    await this.buttonSubmit.click();
    await expect(
      this.arrayResultCards.first(),
      `[${LABEL}] Submit should render at least one result for '${term}'`,
    ).toBeVisible();
  }
}
