import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "Login";

/**
 * BAD version. Same scenario as good/01 but seeded with anti-pattern #4:
 * the team-members KPI locator is a raw `.locator('.kpi-card')` CSS class —
 * the selenium `By.CSS_SELECTOR('.kpi-card')` selector was migrated verbatim
 * instead of being lifted to `getByRole('region', { name: 'Team members' })`
 * per qa-master selector priority. The conformance validator's W5
 * (locator-priority) must flag this row.
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

  // Anti-pattern #4 — raw CSS class survives from the selenium source.
  readonly regionTeamMembersKpi = this.page
    .locator(".kpi-card")
    .first()
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
