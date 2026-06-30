// The envelope.json beside this file is truncated mid-array (invalid JSON).
// plan-code-coverage must fail BEFORE inspecting this code — the unguarded
// JSON.parse used to crash with a raw SyntaxError and no inline annotation;
// the json-guard now emits `::error file=...::` + exit 1.
import { test, expect } from "@playwright/test";

test.describe("Acme login", () => {
  // plan:scenario=1.1
  test("signs in with valid credentials @positive", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("jane@acme.test");
    await page.getByLabel(/password/i).fill("Sup3rSecret!");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
