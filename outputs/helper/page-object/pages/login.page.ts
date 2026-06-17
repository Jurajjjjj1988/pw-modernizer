// Migrated from bad-playwright on 2026-06-17 by Migrator.
// See outputs/plans/force-clicks.spec.ts.md for plan and rationale.
import { expect, type Locator } from '@playwright/test';

import { BasePage } from '@page-object/basepage';
import { LABEL_LOGIN } from '@test-data/labels';
import { URL_LOGIN } from '@test-data/urls';

export class PageClassLogin extends BasePage {
  readonly url = URL_LOGIN;

  readonly inputEmail: Locator = this.page.getByLabel('Email').describe(`[${LABEL_LOGIN}] Email input`);
  readonly inputPassword: Locator = this.page.getByLabel('Password').describe(`[${LABEL_LOGIN}] Password input`);
  readonly buttonSignIn: Locator = this.page.getByRole('button', { name: 'Sign in' }).describe(`[${LABEL_LOGIN}] Sign in button`);
  // TODO: Q1 unresolved: newsletter modal close locator not confirmed — assumed accessible button with name matching /close|dismiss/i.
  readonly buttonDismissNewsletter: Locator = this.page
    .getByRole('button', { name: /close|dismiss/i })
    .describe(`[${LABEL_LOGIN}] Newsletter modal close button`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.inputEmail, `[${LABEL_LOGIN}] Email input visible on login page`).toBeVisible();
  }

  /** Dismiss the newsletter modal that blocks the Sign in button. Modal assumed always present on first page load (Q2 unresolved). */
  async dismissNewsletterModal(): Promise<void> {
    // TODO: Q2 unresolved: modal appearance conditions not confirmed — assumed always-present on first page load in a fresh context.
    await this.buttonDismissNewsletter.click();
  }

  /** Fill email and password from CI env vars and submit. Env vars assumed provisioned (Q4 unresolved). */
  async login(): Promise<void> {
    await this.inputEmail.fill(process.env['TEST_USER_EMAIL'] ?? '');
    await this.inputPassword.fill(process.env['TEST_USER_PASSWORD'] ?? '');
    await this.buttonSignIn.click();
  }
}
