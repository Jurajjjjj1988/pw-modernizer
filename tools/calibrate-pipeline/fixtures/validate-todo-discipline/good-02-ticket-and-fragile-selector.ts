// Calibration fixture (good case): two justified deferral markers — one ties
// back to a linked ticket (JIRA-123) and one declares an intentional fragile
// selector. Both forms are on the allowlist, so the scanner must stay clean.

import { type Locator, type Page } from "@playwright/test";

export class PageClassSearch {
  readonly arrayResults: Locator;

  constructor(private readonly page: Page) {
    // TODO: JIRA-123 — storefront has no role-based result container yet;
    // remove this fallback once the design system ships the listitem markup.
    this.arrayResults = this.page.locator("[data-result]");
  }

  resultAt(index: number): Locator {
    // TODO: fragile selector — positional pick is intentional; the API does
    // not expose a stable id per row until the pagination refactor lands.
    return this.arrayResults.nth(index);
  }
}
