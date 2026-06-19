// Calibration fixture (good case): justified deferral markers referencing a
// GitHub issue (#42) and the `add testid` follow-up form. Both are on the
// allowlist, so the scanner must report the file as clean.

import { type Locator, type Page } from "@playwright/test";

export class PageClassLogin {
  readonly inputUsername: Locator;
  readonly buttonSubmit: Locator;

  constructor(private readonly page: Page) {
    // TODO: add testid — the username field has no test id upstream; xpath
    // fallback is a stopgap until the app team annotates the input.
    this.inputUsername = this.page.locator("//input[@name='user']");
    // TODO: #42 — tracked in the storefront repo; switch to getByRole once
    // the submit button gains an accessible name.
    this.buttonSubmit = this.page.locator("button[type=submit]");
  }
}
