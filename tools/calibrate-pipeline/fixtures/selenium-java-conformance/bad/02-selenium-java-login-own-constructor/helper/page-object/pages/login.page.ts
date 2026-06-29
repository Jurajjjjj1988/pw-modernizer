import { expect, type Locator, type Page } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Login";

/**
 * Bad fixture — same login scenario as good/02 but seeded with a single
 * block-severity violation: the PageClass declares its own constructor, which
 * KB pwm-blueprint/architecture/no-constructor forbids (BasePage already wires
 * `page`; subclasses use readonly fields referencing `this.page`).
 */
export class PageClassLogin extends BasePage {
  readonly url = "/login";

  // Anti-pattern: own constructor on a PageClass.
  constructor(page: Page) {
    super(page);
  }

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
