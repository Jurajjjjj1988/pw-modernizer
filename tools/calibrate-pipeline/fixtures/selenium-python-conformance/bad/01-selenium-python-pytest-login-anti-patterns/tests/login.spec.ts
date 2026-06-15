// Anti-pattern #2 — runtime `test` and `expect` imported from `@playwright/test`
// directly instead of `@fixtures/base.fixture`. Conformance Check 1 must block.
import { test, expect } from "@playwright/test";

const ADMIN = {
  email: "hr-admin@beacon.test",
  password: "Sup3rSecret!",
} as const;

test.describe(
  "Beacon HR: Login and dashboard KPI",
  { tag: ["@desktop", "@beacon-hr", "@auth"] },
  () => {
    test(
      "[QA-201] - Check that valid credentials sign the admin in",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting hr-admin@beacon.test with valid password lands on /dashboard and shows the welcome greeting",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ page }) => {
        await test.step("Open the login page", async () => {
          // Anti-pattern #3 — spec drives navigation directly instead of a
          // PageClass.open(). Conformance Check 7 must block.
          await page.goto("/login");
          await expect(
            page.getByLabel("Email"),
            "Email field should be visible on the login page",
          ).toBeVisible();
        });

        await test.step("Submit valid credentials", async () => {
          await page.getByLabel("Email").fill(ADMIN.email);
          await page.getByLabel("Password").fill(ADMIN.password);
          await page.getByRole("button", { name: "Sign in" }).click();
          // Anti-pattern #1 — hard wait carried over from the selenium
          // `time.sleep(2)`. The qa-master architecture forbids hard waits
          // anywhere under outputs/. Conformance Check 8 must block.
          await page.waitForTimeout(2000);
          await expect(
            page.getByRole("heading", { name: /welcome back/i }),
            "Dashboard greeting should be visible after sign-in",
          ).toHaveText("Welcome back, HR Admin");
        });
      },
    );
  },
);
