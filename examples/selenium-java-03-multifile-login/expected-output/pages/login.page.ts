/**
 * Acme Shop - login page object.
 *
 * Slim Playwright POM: locators + navigation only. No assertions inside the
 * POM (per company-style.spec.ts §9 — POMs do NOT assert).
 *
 * Replaces the Selenium hierarchy of BasePage + LoginPage + WebDriverConfig
 * (3 files, 123 LOC of driver-lifecycle plumbing) with a single composition-
 * over-inheritance class. ThreadLocal driver / PageFactory / implicit-wait /
 * try-catch-as-flow are all dropped because Playwright's `page` fixture +
 * web-first auto-retry replace each of them.
 */
import type { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly emailField: Locator;
  readonly passwordField: Locator;
  readonly signInButton: Locator;
  readonly errorBanner: Locator;

  constructor(private readonly page: Page) {
    this.emailField = page.getByLabel('Email');
    this.passwordField = page.getByLabel('Password');
    this.signInButton = page.getByRole('button', { name: 'Sign in' });
    this.errorBanner = page.getByRole('alert');
  }

  async open(): Promise<void> {
    await this.page.goto('/login');
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.emailField.fill(email);
    await this.passwordField.fill(password);
    await this.signInButton.click();
  }
}
