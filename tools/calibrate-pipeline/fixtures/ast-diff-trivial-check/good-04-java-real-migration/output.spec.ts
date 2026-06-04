import { test, expect } from "@playwright/test";

test.describe("login", () => {
  // plan:scenario=1.1
  test("signs in with valid credentials @positive", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("jane@acme.test");
    await page.getByLabel(/password/i).fill("hunter2");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });
});
