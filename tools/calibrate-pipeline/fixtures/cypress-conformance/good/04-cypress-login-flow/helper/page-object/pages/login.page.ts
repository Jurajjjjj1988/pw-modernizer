import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Login";

/**
 * HR admin login page. Migrated from `cypress-01-login-flow`: the cypress
 * source chained `cy.get('div.auth-card form input[type="email"]')` and
 * `cy.contains('Sign in')`; pwm-blueprint uses role-based locators for the
 * form controls and waits on the dashboard greeting after submit instead
 * of `cy.wait(2000)`.
 */
export class PageClassLogin extends BasePage {
  readonly url = "/login";

  readonly textLoginHeading = this.page
    .getByRole("heading", { name: /sign in/i })
    .describe(`[${LABEL}] Sign-in heading`);

  readonly inputEmail = this.page
    .getByRole("textbox", { name: /email/i })
    .describe(`[${LABEL}] Email field`);

  readonly inputPassword = this.page
    .getByLabel(/password/i)
    .describe(`[${LABEL}] Password field`);

  readonly buttonSubmit = this.page
    .getByRole("button", { name: /sign in/i })
    .describe(`[${LABEL}] Submit button`);

  readonly textWelcomeGreeting = this.page
    .getByText(/welcome/i)
    .describe(`[${LABEL}] Welcome greeting on dashboard`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.textLoginHeading,
      `[${LABEL}] Sign-in heading should be visible`,
    ).toBeVisible({ timeout: 30_000 });
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.inputEmail.fill(email);
    await this.inputPassword.fill(password);
    await this.buttonSubmit.click();
    await expect(
      this.textWelcomeGreeting,
      `[${LABEL}] Submit should land on the dashboard with the greeting visible`,
    ).toBeVisible();
  }
}
