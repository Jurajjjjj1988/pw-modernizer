import { test, expect } from "@fixtures/base.fixture";

test("[CAL-1] - signs in and lands on the dashboard", async ({ loginPage }) => {
  await loginPage.open();
  await loginPage.signIn("a@b.c", "secret");
  await expect(loginPage.welcomeHeading).toBeVisible();
});
