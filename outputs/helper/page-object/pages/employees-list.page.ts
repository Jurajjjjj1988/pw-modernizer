// Migrated from selenium-python on 2026-06-16 by Migrator.
// See outputs/plans/test_employees.py.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { PageClassEmployeesDetail } from "@page-object/pages/employees-detail.page";
import { LABEL_EMPLOYEES_LIST } from "@test-data/labels";

export class PageClassEmployeesList extends BasePage {
  readonly url = "/employees";

  // TODO Q1 unresolved: search_box locator from pages/employees_page.py unavailable — assumed role=searchbox or <input type='search'>
  readonly inputSearch: Locator = this.page
    .getByRole("searchbox")
    .describe(`[${LABEL_EMPLOYEES_LIST}] Search input`);

  // TODO Q2 unresolved: search_button accessible name from pages/employees_page.py unavailable
  readonly buttonSearch: Locator = this.page
    .getByRole("button", { name: /search|filter/i })
    .describe(`[${LABEL_EMPLOYEES_LIST}] Search/filter button`);

  // TODO Q3 unresolved: table class selector may be fragile — prefer getByRole('row') if semantic <table> confirmed
  readonly tableRows: Locator = this.page
    .locator("table.employees-table tbody tr")
    .describe(`[${LABEL_EMPLOYEES_LIST}] Employee table rows`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.inputSearch,
      `[${LABEL_EMPLOYEES_LIST}] search input should be visible on page load`
    ).toBeVisible();
  }

  async searchByDepartment(department: string): Promise<void> {
    await this.inputSearch.fill(department);
    await this.buttonSearch.click();
    await expect(
      this.tableRows,
      `[${LABEL_EMPLOYEES_LIST}] filtered rows should be visible after search`
    ).not.toHaveCount(0);
  }

  async clickFirstRow(): Promise<PageClassEmployeesDetail> {
    // TODO Q4: using first() because no stable row accessible name is known; sort order may be indeterminate
    await this.tableRows.first().click();
    const detailPage = new PageClassEmployeesDetail(this.page);
    await detailPage.waitForPageLoad();
    return detailPage;
  }
}
