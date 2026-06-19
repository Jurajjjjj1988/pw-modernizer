import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from inputs/selenium-java/EmployeesTest.java. The JUnit source
 * opened the employees grid and asserted a known row exists; qa-master moves
 * the grid interaction into EmployeesPage and uses Playwright auto-wait.
 */
test.describe("Employees: directory grid", { tag: ["@desktop"] }, () => {
  test(
    "[QA-410] - Check that a known employee row renders in the directory",
    { tag: ["@smoke"] },
    async ({ employeesPage }) => {
      await test.step("Open the employees directory", async () => {
        await employeesPage.open();
        await expect(
          employeesPage.gridDirectory,
          "Directory grid should be visible on load",
        ).toBeVisible();
      });

      await test.step("Assert a known employee row is present", async () => {
        await expect(
          employeesPage.rowFor("Ada Lovelace"),
          "Known employee row should render in the directory",
        ).toBeVisible();
      });
    },
  );
});
