// Migrated by PWmodernizer on 2026-06-05 from selenium-java. See outputs/plans/EmployeesTest.java.md for plan.

import { test, expect } from "@playwright/test";
import { EmployeesPage } from "./pages/employees.page";

test.describe("Employees page", () => {
  let employees: EmployeesPage;

  test.beforeEach(async ({ page }) => {
    employees = new EmployeesPage(page);
    await employees.navigate();
  });

  // plan:scenario=1.1
  test(
    "search filters the employee grid to show matching rows",
    { tag: ["@positive"] },
    async () => {
      await employees.search("Jane");
      // Risk (plan §search-debounce): not.toHaveCount(0) is the >= 1 gate; toContainText(/jane/i) on the first
      // row is the real regression oracle — the row-count assertion alone would pass against an unfiltered grid.
      await expect(employees.gridRows).not.toHaveCount(0);
      await expect(employees.firstRowNameCell).toContainText(/jane/i);
    },
  );

  // plan:scenario=1.2
  test(
    "inviting a new employee shows a confirmation toast",
    { tag: ["@positive"] },
    async () => {
      // Append workerIndex to avoid email-uniqueness collisions under fullyParallel (plan risk callout 4, KB-1.2.49).
      const email = `new.hire+${test.info().workerIndex}@beacon.test`;
      await employees.openInviteModal();
      await expect(employees.inviteDialog).toBeVisible();
      await employees.fillAndSubmitInvite(email);
      // Q6 unresolved: toast ARIA role not confirmed; toContainText tolerates icon spans (plan risk callout 5).
      await expect(employees.confirmationToast).toContainText("Invitation sent");
    },
  );
});
