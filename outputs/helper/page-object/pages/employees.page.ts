// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/EmployeesTest.java.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { EMPLOYEES_PATH } from "@test-data/employees";

const LABEL = "Employees";

/**
 * Employees management page (HR portal).
 * Covers the search-filter flow and the invite-new-employee modal flow.
 * Assertions stay in the spec; this class owns locators + multi-step actions.
 */
export class PageClassEmployees extends BasePage {
  readonly url = EMPLOYEES_PATH;

  // Direct id→CSS per KB §6 Rule 1 (HIGH confidence — stable regardless of label presence).
  // TODO: Q1 — if a <label for="search-employees"> exists, upgrade to getByLabel(/search/i) for a11y.
  readonly searchInput: Locator = this.page
    .locator("#search-employees")
    .describe(`[${LABEL}] Search employees input`);

  // Q3 unresolved: accessible name of add-employee header button not confirmed — /add/i assumed.
  readonly addButton: Locator = this.page
    .getByRole("button", { name: /add/i })
    .describe(`[${LABEL}] Add/Invite employee header button`);

  // Q4 unresolved: modal role='dialog' not confirmed.
  readonly inviteDialog: Locator = this.page
    .getByRole("dialog")
    .describe(`[${LABEL}] Invite employee modal dialog`);

  // Q5 unresolved: email input label not confirmed — assumes single textbox in modal.
  readonly inviteEmailInput: Locator = this.page
    .getByRole("dialog")
    .getByRole("textbox")
    .describe(`[${LABEL}] Invite email address input`);

  // Q4 unresolved: send-button accessible name not confirmed — /send|invite/i assumed.
  readonly sendButton: Locator = this.page
    .getByRole("dialog")
    .getByRole("button", { name: /send|invite/i })
    .describe(`[${LABEL}] Send invitation button`);

  // Q7 unresolved: grid DOM structure (table vs div) not confirmed — CSS class selector retained.
  readonly gridRows: Locator = this.page
    .locator(".employees-grid .row")
    .describe(`[${LABEL}] Employee grid rows`);

  // Q7 unresolved: grid DOM structure not confirmed — positional first() retained as fallback.
  // TODO: Q7 — if grid is semantic <table> with <tr>/<td>, use getByRole('row').nth(1).getByRole('cell')
  readonly firstRowNameCell: Locator = this.page
    .locator(".employees-grid .row .name")
    .first()
    .describe(`[${LABEL}] First employee row name cell`);

  // Q6 unresolved: toast ARIA role not confirmed — toContainText (not toHaveText) tolerates icon spans.
  readonly confirmationToast: Locator = this.page
    .getByRole("alert")
    .describe(`[${LABEL}] Invitation sent confirmation toast`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.searchInput,
      `[${LABEL}] Search input should be visible when employees page loads`,
    ).toBeVisible();
  }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  async openInviteModal(): Promise<void> {
    // Q2 unresolved: if addButton is hover-revealed, addButton.hover() must precede this click.
    await this.addButton.click();
  }

  async fillAndSubmitInvite(email: string): Promise<void> {
    await this.inviteEmailInput.fill(email);
    await this.sendButton.click();
  }
}
