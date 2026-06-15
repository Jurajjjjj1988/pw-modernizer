import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Login";

/**
 * Acme login page + dashboard-landing surface. Migrated from
 * `examples/selenium-python-03-multifile-login/input/`. The selenium source
 * located inputs by `By.ID('email')`/`By.ID('password')`, the submit button
 * by `By.XPATH("//form//button[@type='submit']")`, then wrapped
 * `WebDriverWait(driver, 5).until(EC.presence_of_element_located((By.XPATH,
 * "//header//h1[contains(text(), 'Dashboard')]")))` around the dashboard
 * header check + read pass/fail via `"Welcome, Jane" in driver.page_source`.
 * The qa-master flow owns navigation through `open()`, uses
 * `getByLabel`/`getByRole` per selector priority, lifts the XPath dashboard
 * header to `getByRole('heading', { name: 'Dashboard' })`, and replaces
 * every `WebDriverWait` + `page_source` substring probe with web-first
 * `toHaveURL` / `toBeVisible` auto-waiting assertions.
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

  readonly textWelcomeGreeting = this.page
    .getByText(/welcome,\s*jane/i)
    .describe(`[${LABEL}] Welcome greeting on the dashboard`);

  readonly textErrorMessage = this.page
    .getByRole("alert")
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

  /**
   * Fill the email + password fields and submit. Asserts the submit button
   * leaves the busy / disabled state after click so the method never ends
   * on `.click()` per the qa-master `page-object/click-without-assertion`
   * rule — the post-submit landing (dashboard vs inline error) is the
   * spec's job to assert on.
   */
  async signIn(email: string, password: string): Promise<void> {
    await this.inputEmail.fill(email);
    await this.inputPassword.fill(password);
    await this.buttonSubmit.click();
    await expect(
      this.buttonSubmit,
      `[${LABEL}] Submit button should re-enable after the sign-in request resolves`,
    ).toBeEnabled();
  }
}
