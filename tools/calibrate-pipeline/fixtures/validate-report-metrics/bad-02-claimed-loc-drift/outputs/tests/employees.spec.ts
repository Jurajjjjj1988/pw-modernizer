import { test, expect } from "@fixtures/base.fixture";

/**
 * The basename derives correctly from EmployeesTest.java and the file exists,
 * so the only violation is the report's claimed Output LOC drifting from this
 * file's real line count by more than one.
 */
test.describe("Employees: directory grid", { tag: ["@desktop"] }, () => {
  test(
    "[QA-410] - Check that a known employee row renders in the directory",
    { tag: ["@smoke"] },
    async ({ employeesPage }) => {
      await employeesPage.open();
      await expect(
        employeesPage.rowFor("Ada Lovelace"),
        "Known employee row should render in the directory",
      ).toBeVisible();
    },
  );
});
