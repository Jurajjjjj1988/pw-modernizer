import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("https://app.acme.test/login");
  await page.locator("#email").fill("admin@acme.test");
  await page.locator("#password").fill("hunter2");
  await page.locator("button.signin").click();
  await page.waitForTimeout(1500);
});

test("admin can view team", async ({ page }) => {
  await page.locator("a.team-link").click();
  expect(await page.locator(".team-table tbody tr").count()).toBeGreaterThan(0);
});

test("admin can open settings", async ({ page }) => {
  await page.locator("a.settings-link").click();
  expect(await page.locator("h1.settings-title").innerText()).toBe("Settings");
});
