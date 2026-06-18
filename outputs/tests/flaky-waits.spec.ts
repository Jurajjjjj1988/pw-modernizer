// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/flaky-waits.spec.ts.md for plan and rationale.

import { test } from "@fixtures/base.fixture";

// Credentials extracted from inline magic strings (KB-1.1.9). Move to env vars per Q7 if password rotation is needed.
const VALID_EMAIL = "jane.doe@acme.test";
const VALID_PASSWORD = "Sup3rSecret!";
const INVALID_PASSWORD = "wrong-password";
const EXPECTED_ERROR_TEXT = "Invalid credentials";

test.describe("Acme Shop login", () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.open();
  });

  // plan:scenario=1.1
  test("signs in with valid credentials @positive", async ({ loginPage, dashboardPage }) => {
    await test.step("fill valid credentials and submit the sign-in form", async () => {
      await loginPage.fillCredentials(VALID_EMAIL, VALID_PASSWORD);
      await loginPage.clickSignIn();
    });

    await test.step("dashboard greeting confirms authenticated session", async () => {
      await dashboardPage.waitForPageLoad();
      await dashboardPage.expectWelcomeHeading();
    });
  });

  // plan:scenario=1.2
  test("rejects an invalid password @negative", async ({ loginPage }) => {
    await test.step("fill valid email with wrong password and submit the sign-in form", async () => {
      await loginPage.fillCredentials(VALID_EMAIL, INVALID_PASSWORD);
      await loginPage.clickSignIn();
    });

    await test.step("error banner shows invalid credentials message", async () => {
      await loginPage.expectErrorMessage(EXPECTED_ERROR_TEXT);
    });
  });
});
