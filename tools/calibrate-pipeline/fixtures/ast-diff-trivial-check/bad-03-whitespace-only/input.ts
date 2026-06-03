import { test, expect } from "@playwright/test";

test("renders dashboard", async ({ page }) => {
  await page.goto("https://app.acme.test/dashboard");
  await page.locator(".sidebar a.team").click();
  await page.waitForTimeout(500);
  const count = await page.locator(".team-table tbody tr").count();
  expect(count).toBeGreaterThan(0);
});
