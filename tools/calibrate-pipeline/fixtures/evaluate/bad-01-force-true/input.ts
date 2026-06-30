import { test, expect } from "@playwright/test";

test("legacy login", async ({ page }) => {
  await page.goto("/login");
  await page.waitForTimeout(500);
  await page.locator("#email").fill("a@b.c");
  await page.locator(".submit-btn").click({ force: true });
  expect(await page.locator(".welcome").isVisible()).toBe(true);
});
