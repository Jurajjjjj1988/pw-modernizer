// Calibration fixture (bad case): a deferral marker with neither a colon nor
// any justification text — the empty-justification rejection mode. The header
// avoids the trigger tokens so only the seeded line trips the rule.

import { type Locator, type Page } from "@playwright/test";

export class PageClassProfile {
  readonly headingName: Locator;

  constructor(private readonly page: Page) {
    // TODO
    this.headingName = this.page.getByRole("heading", { level: 1 });
  }
}
