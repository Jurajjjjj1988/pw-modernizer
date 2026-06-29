import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Login";

/**
 * Auth login. Migrated from a Selenium Java login test: the source found the
 * username via `By.id("user")` + a `WebDriverWait` polling for the dashboard;
 * pwm-blueprint uses role-based locators and relies on Playwright auto-wait.
 */
export class PageClassLogin extends BasePage {
  readonly url = "/login";

  readonly inputUsername = this.page
    .getByRole("textbox", { name: /username/i })
    .describe(`[${LABEL}] Username input`);

  readonly inputPassword = this.page
    .getByRole("textbox", { name: /password/i })
    .describe(`[${LABEL}] Password input`);

  readonly buttonSignIn = this.page
    .getByRole("button", { name: /sign in/i })
    .describe(`[${LABEL}] Sign-in button`);

  readonly headingDashboard = this.page
    .getByRole("heading", { name: /dashboard/i })
    .describe(`[${LABEL}] Dashboard heading`);

  async signIn(username: string, password: string): Promise<void> {
    await this.inputUsername.fill(username);
    await this.inputPassword.fill(password);
    await this.buttonSignIn.click();
    await expect(
      this.headingDashboard,
      `[${LABEL}] Dashboard should render after a successful sign-in`,
    ).toBeVisible();
  }
}
