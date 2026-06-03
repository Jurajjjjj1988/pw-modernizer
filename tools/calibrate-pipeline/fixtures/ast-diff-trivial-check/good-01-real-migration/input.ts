import { test, expect } from "@playwright/test";

test("login flow", async ({ page }) => {
  await page.goto("https://app.acme.test/login");
  await page.locator("#email").fill("jane@acme.test");
  await page.locator("#password").fill("hunter2");
  await page.locator("button.primary").click();
  await page.waitForTimeout(2000);
  const visible = await page.locator(".dashboard-greeting").isVisible();
  expect(visible).toBe(true);
});
