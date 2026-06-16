// Calibration fixture (bad case): the spec consumes only the login helper. The
// setup wrapper from the api file is never imported here, so the validator
// must flag it as unreferenced. (Intentionally not naming the dead helper in
// this comment — a literal mention would defeat the word-boundary check.)

import { test, expect } from "@playwright/test";
import { login } from "../helper/api/auth.api";

test("logs in with valid credentials", async ({ request, page }) => {
  await login(request, "standard_user", "secret_sauce");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
});
