import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Login";

/**
 * Beacon HR login page. Migrated from `examples/selenium-python-01-login/input.py`:
 * the selenium source navigated via `driver.get(...)`, located inputs by
 * `By.ID('email')`/`By.ID('password')` + `By.XPATH` for submit, then slept
 * `time.sleep(2)` before asserting `.dashboard-greeting`. The pwm-blueprint flow
 * owns navigation through `open()`, uses `getByLabel`/`getByRole` per the
 * selector-priority ladder, and waits on web-first assertions instead of
 * `time.sleep()` — no manual waits anywhere. The post-login surface
 * (greeting + team-members KPI) lives on this same page object since the
 * source's two tests both end on the dashboard.
 */
export class PageClassLogin extends BasePage {
  readonly url = "/login";

  readonly inputEmail = this.page
    .getByLabel("Email")
    .describe(`[${LABEL}] Email field`);

  readonly inputPassword = this.page
    .getByLabel("Password")
    .describe(`[${LABEL}] Password field`);

  readonly buttonSignIn = this.page
    .getByRole("button", { name: "Sign in" })
    .describe(`[${LABEL}] Sign in button`);

  readonly textDashboardGreeting = this.page
    .getByRole("heading", { name: /welcome back/i })
    .describe(`[${LABEL}] Dashboard greeting`);

  readonly regionTeamMembersKpi = this.page
    .getByRole("region", { name: "Team members" })
    .describe(`[${LABEL}] Team members KPI card`);

  async open(): Promise<void> {
    await this.page.goto(this.url, { timeout: 60_000 });
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.inputEmail,
      `[${LABEL}] Email field should be visible on the login page`,
    ).toBeVisible({ timeout: 30_000 });
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.inputEmail.fill(email);
    await this.inputPassword.fill(password);
    await this.buttonSignIn.click();
    await expect(
      this.page,
      `[${LABEL}] Submitting valid credentials should land on the dashboard`,
    ).toHaveURL(/\/dashboard/);
  }
}
