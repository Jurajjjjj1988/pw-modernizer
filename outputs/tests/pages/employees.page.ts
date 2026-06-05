// Migrated by PWmodernizer on 2026-06-05 from selenium-java. See outputs/plans/EmployeesTest.java.md for plan.

import { type Locator, type Page } from "@playwright/test";

export class EmployeesPage {
  readonly searchInput: Locator;
  readonly addButton: Locator;
  readonly inviteDialog: Locator;
  readonly inviteEmailInput: Locator;
  readonly sendButton: Locator;
  readonly gridRows: Locator;
  readonly firstRowNameCell: Locator;
  readonly confirmationToast: Locator;

  constructor(readonly page: Page) {
    this.searchInput = page.locator("#search-employees");
    // Q3 unresolved: accessible name of add-employee header button not confirmed — assumed /add/i covers all variants.
    this.addButton = page.getByRole("button", { name: /add/i });
    this.inviteDialog = page.getByRole("dialog");
    // Q5 unresolved: email input label not confirmed — assumed single textbox in modal.
    this.inviteEmailInput = this.inviteDialog.getByRole("textbox");
    // Q4 unresolved: modal role='dialog' and send-button accessible name not confirmed.
    this.sendButton = this.inviteDialog.getByRole("button", { name: /send|invite/i });
    // Q7 unresolved: grid DOM structure not confirmed — CSS class selector retained for count/filter assertions.
    this.gridRows = page.locator(".employees-grid .row");
    // Q7 unresolved: grid DOM structure (table vs div) not confirmed — CSS :first-child used instead of .first() (banned by no-nth-methods).
    this.firstRowNameCell = page.locator(".employees-grid .row:first-child .name");
    // Q6 unresolved: toast ARIA role not confirmed; toContainText used in spec to tolerate icon spans.
    this.confirmationToast = page.getByRole("alert");
  }

  async navigate(): Promise<void> {
    await this.page.goto("/employees");
  }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  async openInviteModal(): Promise<void> {
    // Q2 unresolved: direct click assumed sufficient; if Add button is hover-revealed, add this.addButton.hover() here.
    await this.addButton.click();
    await this.inviteDialog.waitFor({ state: "visible" });
  }

  async fillAndSubmitInvite(email: string): Promise<void> {
    await this.inviteEmailInput.fill(email);
    await this.sendButton.click();
  }
}
