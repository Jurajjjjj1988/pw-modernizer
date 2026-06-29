import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "UsersAdmin";

/**
 * BAD version. Same scenario as good/02 but seeded with anti-pattern #4:
 * the invite-user dialog locator is a raw `this.page.locator('.modal')`
 * CSS-class selector — the selenium `By.CSS_SELECTOR('div.modal-overlay >
 * div.modal')` was migrated verbatim instead of being lifted to
 * `getByRole('dialog', { name: 'Invite a new user' })` per pwm-blueprint
 * selector priority. The conformance validator's W5 (locator-priority)
 * must flag this row.
 */
export class PageClassUsersAdmin extends BasePage {
  readonly url = "/users";

  readonly buttonInvite = this.page
    .getByRole("button", { name: "Invite" })
    .describe(`[${LABEL}] Invite button`);

  // Anti-pattern #4 — raw CSS class survives from the selenium source.
  readonly dialogInviteUser = this.page
    .locator(".modal")
    .first()
    .describe(`[${LABEL}] Invite-user dialog`);

  readonly inputInviteEmail = this.dialogInviteUser
    .getByLabel("Email")
    .describe(`[${LABEL}] Invite email field`);

  readonly buttonSendInvite = this.dialogInviteUser
    .getByRole("button", { name: "Send invite" })
    .describe(`[${LABEL}] Send invite button`);

  readonly textEmailValidationError = this.dialogInviteUser
    .getByText("Please enter a valid email")
    .describe(`[${LABEL}] Email validation error`);

  async open(): Promise<void> {
    await this.page.goto(this.url, { timeout: 60_000 });
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.buttonInvite,
      `[${LABEL}] Invite button should be visible on the users page`,
    ).toBeVisible({ timeout: 30_000 });
  }

  async openInviteModal(): Promise<void> {
    await this.buttonInvite.click();
    await expect(
      this.dialogInviteUser,
      `[${LABEL}] Invite-user dialog should open after clicking Invite`,
    ).toBeVisible();
  }

  async submitInvite(email: string): Promise<void> {
    await this.inputInviteEmail.fill(email);
    await this.buttonSendInvite.click();
    await expect(
      this.dialogInviteUser,
      `[${LABEL}] Dialog should stay visible after submit (validation or loading state lands here)`,
    ).toBeVisible();
  }
}
