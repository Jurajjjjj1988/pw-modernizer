import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Settings";

/**
 * BAD version. Same scenario as good/03 but seeded with anti-pattern #4:
 * the theme-preview locator is a raw `.locator('.theme-preview')` CSS class —
 * the cypress `cy.get('.theme-preview')` selector was migrated verbatim
 * instead of being lifted to `getByRole('region', { name: 'Theme preview' })`
 * per pwm-blueprint selector priority. The conformance validator's W5
 * (locator-priority) must flag this row.
 */
export class PageClassSettings extends BasePage {
  readonly url = "/settings";

  readonly headingSettings = this.page
    .getByRole("heading", { name: "Settings", level: 1 })
    .describe(`[${LABEL}] Settings page heading`);

  readonly toggleDarkMode = this.page
    .getByLabel("Dark mode")
    .describe(`[${LABEL}] Dark mode toggle`);

  readonly inputDisplayName = this.page
    .getByLabel("Display name")
    .describe(`[${LABEL}] Display name field`);

  readonly buttonSave = this.page
    .getByRole("button", { name: "Save" })
    .describe(`[${LABEL}] Save button`);

  // Anti-pattern #4 — raw CSS class survives from the cypress source.
  readonly regionThemePreview = this.page.locator(".theme-preview")
    .describe(`[${LABEL}] Theme preview region`);

  async open(): Promise<void> {
    await this.page.goto(this.url, { timeout: 60_000 });
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.headingSettings,
      `[${LABEL}] Settings heading should be visible on the page`,
    ).toBeVisible({ timeout: 30_000 });
  }
}
