import { test, expect } from "@playwright/test";

test("admin can authenticate", async ({ browserPage }) => {
  await browserPage.goto("https://app.acme.test/login");
  await browserPage.locator("#emailField").fill("admin@acme.test");
  await browserPage.locator("#pwField").fill("supersecret");
  await browserPage.locator("button.primary").click();
  await browserPage.waitForTimeout(2000);
  const isShown = await browserPage.locator(".dashboard-greeting").isVisible();
  expect(isShown).toBe(true);
});
