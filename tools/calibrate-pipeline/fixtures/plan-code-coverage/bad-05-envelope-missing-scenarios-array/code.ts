// The envelope.json beside this file is valid JSON but omits the `scenarios`
// array. The blind `as Envelope` cast used to let this through until a
// validator dereferenced `envelope.scenarios.map(...)` and crashed; the
// json-guard now rejects it up front with `::error file=...::` + exit 1.
import { test, expect } from "@playwright/test";

test.describe("Acme login", () => {
  // plan:scenario=1.1
  test("signs in with valid credentials @positive", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("jane@acme.test");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
