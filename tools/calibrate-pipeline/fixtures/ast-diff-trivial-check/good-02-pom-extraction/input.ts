import { test, expect } from "@playwright/test";

test("checkout flow", async ({ page }) => {
  await page.goto("https://shop.acme.test/cart");
  await page.locator(".item-row").nth(0).locator(".qty-input").fill("2");
  await page.locator("button.checkout").click();
  await page.locator("#shipping-name").fill("Jane Doe");
  await page.locator("#shipping-address").fill("1 Acme Way");
  await page.locator("#shipping-city").fill("Brno");
  await page.locator("#card-number").fill("4242424242424242");
  await page.locator("button.pay-now").click();
  expect(await page.locator(".thank-you").isVisible()).toBe(true);
});
