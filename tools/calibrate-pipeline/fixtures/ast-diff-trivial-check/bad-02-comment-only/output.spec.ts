// Migrated version of the contact form smoke test.
// This file looks "modernised" because of the new docblocks,
// but the structure is identical to the input. The LLM only
// added prose and left every selector + call shape untouched.
import { test, expect } from "@playwright/test";

// plan:scenario=1.1 -- submits the contact form
test("submit form flow", async ({ page }) => {
  // Navigate to the contact form
  await page.goto("https://forms.acme.test/contact");
  // Fill the name field
  await page.locator("#name").fill("Jane");
  // Fill the message body
  await page.locator("#message").fill("Hello");
  // Click the send button
  await page.locator("button.send").click();
  // Pause for the banner animation
  await page.waitForTimeout(1000);
  // Read banner visibility
  const visible = await page.locator(".success-banner").isVisible();
  // Assert it's shown
  expect(visible).toBe(true);
});
