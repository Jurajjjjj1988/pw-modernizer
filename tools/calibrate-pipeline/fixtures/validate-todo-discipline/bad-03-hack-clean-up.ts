// Calibration fixture (bad case): a clean-up marker with a colon but a
// free-text justification that matches no allowlist form. The header avoids
// the trigger tokens so only the seeded line below trips the rule.

import { type Locator, type Page } from "@playwright/test";

export class PageClassDashboard {
  readonly panelSummary: Locator;

  constructor(private readonly page: Page) {
    // HACK: clean up
    this.panelSummary = this.page.getByRole("region", { name: /summary/i });
  }
}
