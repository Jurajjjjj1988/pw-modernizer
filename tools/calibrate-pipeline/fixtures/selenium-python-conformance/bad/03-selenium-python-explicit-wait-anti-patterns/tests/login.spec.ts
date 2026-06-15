// Anti-pattern #2 — runtime `test` and `expect` imported from `@playwright/test`
// directly instead of `@fixtures/base.fixture`. Conformance Check 1 must block.
import { test, expect } from "@playwright/test";

const VALID = {
  email: "jane.doe@acme.test",
  password: "Sup3rSecret!",
} as const;

test.describe(
  "Acme: Sign-in flow",
  { tag: ["@desktop", "@acme", "@auth"] },
  () => {
    test(
      "[QA-601] - Check that valid credentials land on /dashboard",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting jane.doe@acme.test with the right password drives /sign-in → /dashboard",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ page }) => {
        await test.step("Open the sign-in page", async () => {
          // Anti-pattern #3 — spec drives navigation directly instead of a
          // PageClass.open(). Conformance Check 7 must block.
          await page.goto("/sign-in");
          await expect(
            page.getByLabel("Email"),
            "Email field should be visible on the sign-in page",
          ).toBeVisible();
        });

        await test.step("Submit valid credentials", async () => {
          await page.getByLabel("Email").fill(VALID.email);
          await page.getByLabel("Password").fill(VALID.password);
          await page.getByRole("button", { name: "Sign in" }).click();
          // Anti-pattern #1 — hard wait carried over from the selenium
          // `WebDriverWait(driver, 5)` ceremony (the migrator mistranslated
          // the explicit wait into a fixed sleep instead of dropping it for
          // web-first auto-waiting). The qa-master architecture forbids hard
          // waits anywhere under outputs/. Conformance Check 8 must block.
          await page.waitForTimeout(5000);
          await expect(
            page.getByRole("heading", { name: "Dashboard" }),
            "Dashboard heading should render on the post-login surface",
          ).toBeVisible();
        });
      },
    );
  },
);
