// Migrated from selenium-python on 2026-06-16 by Migrator.
// See outputs/plans/test_employees.py.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { LABEL_EMPLOYEES_DETAIL } from "@test-data/labels";

export class PageClassEmployeesDetail extends BasePage {
  // No url — navigated to by clicking a list row; URL is dynamic /employees/:id

  // TODO Q5 unresolved: employee detail page DOM structure unknown — text may be split across label/value elements
  readonly textDepartment: Locator = this.page
    .getByText(/Department:/i)
    .describe(`[${LABEL_EMPLOYEES_DETAIL}] Department label/value text`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.textDepartment,
      `[${LABEL_EMPLOYEES_DETAIL}] department text should be visible on page load`
    ).toBeVisible();
  }
}
