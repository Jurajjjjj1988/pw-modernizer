// Migrated by PWmodernizer on 2026-06-16 from inputs/selenium-python/test_employees.py. See outputs/plans/test_employees.py.md for plan.

import { test, expect } from "@fixtures/base.fixture";

import {
  DEPARTMENT_FILTER_ENGINEERING,
  LABEL_EMPLOYEES_DETAIL,
  LABEL_EMPLOYEES_LIST,
  LABEL_EMPLOYEES_NEW,
} from "@test-data/labels";

test.describe("Employees", { tag: ["@e2e"] }, () => {
  // plan:scenario=1.1
  test(
    "[EMP-1.1] - Check that filtering by Engineering department shows matching rows and preserves department context on the detail page",
    async ({ employeesListPage, employeesDetailPage }) => {
      await test.step("open the employees list page", async () => {
        await employeesListPage.open();
        await expect(
          employeesListPage.inputSearch,
          `[${LABEL_EMPLOYEES_LIST}] search input should be visible`
        ).toBeVisible();
      });

      await test.step("filter by Engineering department and verify rows appear", async () => {
        await employeesListPage.searchByDepartment(DEPARTMENT_FILTER_ENGINEERING);
        await expect(
          employeesListPage.tableRows,
          `[${LABEL_EMPLOYEES_LIST}] at least one filtered row should be visible`
        ).not.toHaveCount(0);
      });

      await test.step("click the first filtered row to navigate to the detail page", async () => {
        await employeesListPage.clickFirstRow();
      });

      await test.step("the detail page shows Engineering department context", async () => {
        await expect(
          employeesDetailPage.textDepartment,
          `[${LABEL_EMPLOYEES_DETAIL}] department text should contain Engineering`
        ).toContainText(/Engineering/i);
      });
    }
  );

  // plan:scenario=1.2
  test(
    "[EMP-1.2] - Check that the add-employee form surfaces a validation error on empty submission",
    async ({ employeesNewPage }) => {
      await test.step("open the add employee form page", async () => {
        await employeesNewPage.open();
        await expect(
          employeesNewPage.buttonSubmit,
          `[${LABEL_EMPLOYEES_NEW}] submit button should be visible`
        ).toBeVisible();
      });

      await test.step("click submit without filling any fields", async () => {
        await employeesNewPage.submitEmptyForm();
      });

      await test.step("validation error element is visible", async () => {
        await expect(
          employeesNewPage.alertFormError,
          `[${LABEL_EMPLOYEES_NEW}] form validation error should be visible`
        ).toBeVisible();
      });

      await test.step("validation error contains the required field message", async () => {
        await expect(
          employeesNewPage.alertFormError,
          `[${LABEL_EMPLOYEES_NEW}] form error should mention first name is required`
        ).toContainText(/first name is required/i);
      });
    }
  );
});
