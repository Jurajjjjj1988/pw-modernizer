import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Settings";

/**
 * App settings page. Migrated from
 * `examples/cypress-05-conditional-and-jquery/input.spec.ts`. The cypress
 * source juggled three anti-patterns the qa-master flow refuses to copy:
 * conditional `if ($body.find('.cookie-banner'))` UI probes (replaced by a
 * pre-seeded cookie in the fixture), `cy.get('html').then(($html) =>
 * $html.attr('data-theme'))` jQuery escapes (replaced by a web-first
 * `toHaveAttribute` assertion), and `cy.window().its('app.store')` redux
 * store probes (replaced by an assertion on the user-visible welcome
 * heading). Locators follow the qa-master selector priority — `getByLabel`
 * for form fields, `getByRole('button')` for the Save button, `getByRole`
 * with a heading name for the welcome surface.
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

  readonly headingWelcome = this.page
    .getByRole("heading", { name: /welcome,? alice/i })
    .describe(`[${LABEL}] Welcome greeting after save`);

  readonly htmlRoot = this.page
    .locator("html")
    .describe(`[${LABEL}] Document root (carries data-theme attribute)`);

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

  /**
   * Toggle dark mode and assert via a web-first `toHaveAttribute` — replaces
   * the cypress `$html.attr('data-theme')` jQuery escape.
   */
  async enableDarkMode(): Promise<void> {
    await this.toggleDarkMode.check();
    await expect(
      this.toggleDarkMode,
      `[${LABEL}] Dark mode toggle should be checked after enabling`,
    ).toBeChecked();
    await expect(
      this.htmlRoot,
      `[${LABEL}] Document root should carry data-theme="dark" after toggling`,
    ).toHaveAttribute("data-theme", "dark");
  }

  /**
   * Fill the display name and save. Asserts on the welcome heading
   * (user-visible surface) instead of `cy.window().its('app.store')` Redux
   * internals — closes the cypress "assert on store" anti-pattern.
   */
  async saveDisplayName(name: string): Promise<void> {
    await this.inputDisplayName.fill(name);
    await this.buttonSave.click();
    await expect(
      this.headingWelcome,
      `[${LABEL}] Welcome greeting should render with the saved display name`,
    ).toBeVisible();
  }
}
