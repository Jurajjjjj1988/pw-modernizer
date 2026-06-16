// Migrated from selenium-python on 2026-06-16 by Migrator.
// See outputs/plans/test_employees.py.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { LABEL_EMPLOYEES_NEW } from "@test-data/labels";

export class PageClassEmployeesNew extends BasePage {
  readonly url = "/employees/new";

  // TODO Q6: submit button accessible name unverified — guessed from common add-form label patterns
  readonly buttonSubmit: Locator = this.page
    .getByRole("button", { name: /add employee|save|submit/i })
    .describe(`[${LABEL_EMPLOYEES_NEW}] Form submit button`);

  // TODO Q7 unresolved: .form-error ARIA role unconfirmed — role='alert' is convention for live validation errors but not verified
  readonly alertFormError: Locator = this.page
    .getByRole("alert")
    .describe(`[${LABEL_EMPLOYEES_NEW}] Form validation error`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.buttonSubmit,
      `[${LABEL_EMPLOYEES_NEW}] submit button should be visible on page load`
    ).toBeVisible();
  }

  async submitEmptyForm(): Promise<void> {
    await this.buttonSubmit.click();
  }
}
