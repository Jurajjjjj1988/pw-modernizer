// Calibration fixture (good case): spec consumes BOTH login and revokeSession,
// so the validator must stay silent under --strict.

import { test, expect } from "@playwright/test";
import { login, revokeSession } from "../helper/api/auth.api";

test.afterEach(async ({ request }) => {
  await revokeSession(request);
});

test("logs in with valid credentials", async ({ request, page }) => {
  await login(request, "standard_user", "secret_sauce");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
});
