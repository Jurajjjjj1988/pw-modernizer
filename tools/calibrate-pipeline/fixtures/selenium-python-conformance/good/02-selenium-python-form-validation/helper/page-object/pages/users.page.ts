import { expect } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "UsersAdmin";

/**
 * Keystone Admin users page + invite-user modal. Migrated from
 * `examples/selenium-python-02-modal-interaction/input.py`. The selenium
 * source used positional indexing (`find_elements(...)[0]`, `[1]`) and CSS
 * selectors (`.modal-overlay`, `.modal`, `.field-error`) inside an XPath
 * chain (`//main//button[contains(.,'Invite')]`); the qa-master flow models
 * the modal surface as a single `dialogInviteUser` locator chained off
 * `getByRole('dialog', { name: 'Invite a new user' })` and reads scoped
 * children via `dialogInviteUser.getByLabel('Email')` /
 * `dialogInviteUser.getByRole('button', { name: 'Send invite' })`. No
 * `time.sleep`-equivalents — every check uses a web-first auto-waiting
 * assertion.
 */
export class PageClassUsersAdmin extends BasePage {
  readonly url = "/users";

  readonly buttonInvite = this.page
    .getByRole("button", { name: "Invite" })
    .describe(`[${LABEL}] Invite button`);

  readonly dialogInviteUser = this.page
    .getByRole("dialog", { name: "Invite a new user" })
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

  /**
   * Click Invite to open the modal. Asserts the dialog is visible so the
   * method never ends on `.click()`.
   */
  async openInviteModal(): Promise<void> {
    await this.buttonInvite.click();
    await expect(
      this.dialogInviteUser,
      `[${LABEL}] Invite-user dialog should open after clicking Invite`,
    ).toBeVisible();
  }

  /**
   * Fill the email field inside the modal and submit. Asserts the modal
   * remains open after submit (the validation/loading surface lands inside
   * the same dialog, so the method never ends on `.click()` per the
   * qa-master `page-object/click-without-assertion` rule).
   */
  async submitInvite(email: string): Promise<void> {
    await this.inputInviteEmail.fill(email);
    await this.buttonSendInvite.click();
    await expect(
      this.dialogInviteUser,
      `[${LABEL}] Dialog should stay visible after submit (validation or loading state lands here)`,
    ).toBeVisible();
  }
}
