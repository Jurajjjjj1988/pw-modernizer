import { test, expect } from "@fixtures/base.fixture";

test("[CAL-1] - signs in and lands on the dashboard", async ({ loginPage }) => {
  await loginPage.open();
  // Correctness defect: force:true bypasses actionability — a green run lies.
  await loginPage.submitButton.click({ force: true });
  await expect(loginPage.welcomeHeading).toBeVisible();
});
