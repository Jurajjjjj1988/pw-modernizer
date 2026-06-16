// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/EmployeesTest.java.md for plan and rationale.

import { test, expect } from "@fixtures/base.fixture";

import { INVITE_EMAIL_LOCAL, INVITE_EMAIL_DOMAIN } from "@test-data/employees";

test.describe("Employees page", () => {
  test.beforeEach(async ({ employeesPage }) => {
    await employeesPage.open();
  });

  // plan:scenario=1.1
  test(
    "search filters the employee grid to show matching rows @positive",
    async ({ employeesPage }) => {
      await test.step("type 'Jane' in the employee search box", async () => {
        await employeesPage.search("Jane");
      });

      await test.step("the employee grid has at least one visible row", async () => {
        await expect(
          employeesPage.gridRows,
          "[Employees] Grid should have at least one row after filtering by 'Jane'",
        ).not.toHaveCount(0);
      });

      await test.step("the first visible row's name contains 'jane'", async () => {
        await expect(
          employeesPage.firstRowNameCell,
          "[Employees] First row name should contain 'jane' (case-insensitive)",
        ).toContainText(/jane/i);
      });
    },
  );

  // plan:scenario=1.2
  test(
    "inviting a new employee shows a confirmation toast @positive",
    async ({ employeesPage }) => {
      // Risk #4: append workerIndex to avoid parallel-worker email collision (KB-1.2.49).
      const inviteEmail = `${INVITE_EMAIL_LOCAL}+${test.info().workerIndex}@${INVITE_EMAIL_DOMAIN}`;

      await test.step("open the invite employee modal", async () => {
        await employeesPage.openInviteModal();
        await expect(
          employeesPage.inviteDialog,
          "[Employees] Invite dialog should appear after clicking the Add button",
        ).toBeVisible();
      });

      await test.step("fill in the invite email and submit", async () => {
        await employeesPage.fillAndSubmitInvite(inviteEmail);
      });

      await test.step("the confirmation toast shows 'Invitation sent'", async () => {
        // toContainText guards against icon-span prefix on toast text (Risk #5 / Q6 unresolved).
        await expect(
          employeesPage.confirmationToast,
          "[Employees] Confirmation toast should contain 'Invitation sent' after submitting invite",
        ).toContainText("Invitation sent");
      });
    },
  );
});
