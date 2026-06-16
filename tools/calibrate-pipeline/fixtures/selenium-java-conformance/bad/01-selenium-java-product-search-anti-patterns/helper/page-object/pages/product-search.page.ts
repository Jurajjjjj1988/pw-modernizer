import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "ProductSearch";

export class PageClassProductSearch extends BasePage {
  readonly url = "/";

  readonly inputSearch = this.page
    .getByRole("searchbox", { name: /search/i })
    .describe(`[${LABEL}] Search input`);

  readonly buttonSubmit = this.page
    .getByRole("button", { name: /search/i })
    .describe(`[${LABEL}] Search submit`);

  // Anti-pattern #4: raw CSS-class chain instead of role.
  readonly arrayResultCards = this.page
    .locator(".product-card")
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
