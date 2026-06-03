import { test, expect } from "@playwright/test";

test("submit form flow", async ({ page }) => {
  await page.goto("https://forms.acme.test/contact");
  await page.locator("#name").fill("Jane");
  await page.locator("#message").fill("Hello");
  await page.locator("button.send").click();
  await page.waitForTimeout(1000);
  const visible = await page.locator(".success-banner").isVisible();
  expect(visible).toBe(true);
});
