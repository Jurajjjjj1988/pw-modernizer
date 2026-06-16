// Calibration fixture (good case): the only deferral marker carries a
// plan-question reference (Q<n>), which the discipline scanner accepts as
// justified. Models a low-confidence locator flagged for human follow-up.

import { type Locator, type Page } from "@playwright/test";

export class PageClassCheckout {
  readonly buttonPlaceOrder: Locator;

  constructor(private readonly page: Page) {
    // TODO: Q3 — plan flagged this confirm-button label as low confidence;
    // re-probe against the live SUT before promoting past example status.
    this.buttonPlaceOrder = this.page.getByRole("button", { name: /place order/i });
  }
}
