import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Login";

/**
 * BAD version. Same scenario as good/03 but seeded with anti-pattern #4:
 * the inline error message locator is a raw `.locator('.form-error')` CSS
 * class — the selenium `By.CSS_SELECTOR('.form-error')` selector was
 * migrated verbatim instead of being lifted to `getByRole('alert')` per
 * pwm-blueprint selector priority. The conformance validator's W5
 * (locator-priority) must flag this row.
 */
export class PageClassLogin extends BasePage {
  readonly url = "/sign-in";

  readonly inputEmail = this.page
    .getByLabel("Email")
    .describe(`[${LABEL}] Email field`);

  readonly inputPassword = this.page
    .getByLabel("Password")
    .describe(`[${LABEL}] Password field`);

  readonly buttonSubmit = this.page
    .getByRole("button", { name: "Sign in" })
    .describe(`[${LABEL}] Sign in submit button`);

  readonly headingDashboard = this.page
    .getByRole("heading", { name: "Dashboard" })
    .describe(`[${LABEL}] Dashboard landing heading`);

  // Anti-pattern #4 — raw CSS class survives from the selenium source.
  readonly textErrorMessage = this.page.locator(".form-error")
    .describe(`[${LABEL}] Inline sign-in error message`);

  async open(): Promise<void> {
    await this.page.goto(this.url, { timeout: 60_000 });
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.inputEmail,
      `[${LABEL}] Email field should be visible on the sign-in page`,
    ).toBeVisible({ timeout: 30_000 });
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.inputEmail.fill(email);
    await this.inputPassword.fill(password);
    await this.buttonSubmit.click();
  }
}
