// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/force-clicks.spec.ts.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { LABEL_LOGIN } from "@test-data/labels";
import { URL_LOGIN } from "@test-data/urls";

export class PageClassLogin extends BasePage {
  readonly url = URL_LOGIN;

  readonly inputEmail: Locator = this.page
    .getByLabel("Email")
    .describe(`[${LABEL_LOGIN}] Email input`);
  readonly inputPassword: Locator = this.page
    .getByLabel("Password")
    .describe(`[${LABEL_LOGIN}] Password input`);
  readonly buttonSignIn: Locator = this.page
    .getByRole("button", { name: "Sign in" })
    .describe(`[${LABEL_LOGIN}] Sign in button`);
  // TODO: Q1 unresolved — newsletter modal close locator not confirmed; assumed accessible button with name matching /close|dismiss/i.
  readonly buttonNewsletterClose: Locator = this.page
    .getByRole("button", { name: /close|dismiss/i })
    .describe(`[${LABEL_LOGIN}] Newsletter modal close button`);
  // TODO: Q4 unresolved — role="alert" assumed on .error-banner element; fallback is page.locator('.error-banner') if role absent.
  readonly alertError: Locator = this.page
    .getByRole("alert")
    .describe(`[${LABEL_LOGIN}] Error alert`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.inputEmail,
      `[${LABEL_LOGIN}] Email input visible after page load`
    ).toBeVisible();
  }

  async fillCredentials(email: string, password: string): Promise<void> {
    await this.inputEmail.fill(email);
    await this.inputPassword.fill(password);
  }

  async dismissNewsletterModal(): Promise<void> {
    // TODO: Q1 unresolved — newsletter modal close locator not confirmed — assumed accessible button with name matching /close|dismiss/i.
    // TODO: Q2 unresolved — modal appearance conditions not confirmed — assumed always-present on first page load in a fresh context.
    await this.buttonNewsletterClose.click();
    await expect(
      this.buttonNewsletterClose,
      `[${LABEL_LOGIN}] Newsletter modal dismissed`
    ).toBeHidden();
  }

  async submitSignIn(): Promise<void> {
    await this.buttonSignIn.click();
    await expect(
      this.inputEmail,
      `[${LABEL_LOGIN}] Login page navigated away after sign-in`
    ).toBeHidden();
  }

  async clickSignIn(): Promise<void> {
    await this.buttonSignIn.click();
  }

  async expectErrorMessage(expectedText: string): Promise<void> {
    // Q8 unresolved — source waitForTimeout(7000) suggests backend auth rejection may take 5–7 s; override guards against flake on slow backends.
    await expect(
      this.alertError,
      `[${LABEL_LOGIN}] Error alert visible`
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      this.alertError,
      `[${LABEL_LOGIN}] Error alert contains expected message`
    ).toContainText(expectedText);
  }
}
