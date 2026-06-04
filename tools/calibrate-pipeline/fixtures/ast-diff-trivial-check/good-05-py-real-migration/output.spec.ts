import { test, expect } from "@playwright/test";

test.describe("Beacon HR - login", () => {
  // plan:scenario=1.1
  test("signs in with valid credentials @positive", async ({ page }) => {
    await page.goto("https://hr.beacon.test/login");
    await page.getByLabel("Email").fill("hr-admin@beacon.test");
    await page.getByLabel("Password").fill("Sup3rSecret!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Welcome back, HR Admin" })).toBeVisible();
  });
});
