import { test, expect } from "@fixtures/base.fixture";

/**
 * The emitted spec exists on disk so the basename-derivation check (not the
 * existence check) is the one that fires: the report's Output line carries a
 * snake_case filename copy-pasted from another migration, which cannot derive
 * from the input EmployeesTest.java. Models the PR #13 root cause.
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
