// Calibration fixture (bad case): a single unjustified deferral comment with
// no recognised reference. The scanner must flag the one line below. The
// header avoids the trigger tokens so only the seeded line trips the rule.

import { type Locator, type Page } from "@playwright/test";

export class PageClassCart {
  readonly buttonCheckout: Locator;

  constructor(private readonly page: Page) {
    // TODO refactor later
    this.buttonCheckout = this.page.getByRole("button", { name: /checkout/i });
  }
}
