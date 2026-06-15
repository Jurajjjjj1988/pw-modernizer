// Anti-pattern #2 — runtime `test` and `expect` imported from `@playwright/test`
// directly instead of `@fixtures/base.fixture`. Conformance Check 1 must block.
import { test, expect } from "@playwright/test";

test.describe(
  "Settings: conditional UI + theme + profile",
  { tag: ["@desktop", "@settings", "@profile"] },
  () => {
    test(
      "[QA-503] - Check that saving a display name renders the welcome heading",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Filling 'Alice' into Display name and clicking Save renders the welcome heading",
          },
        ],
        tag: ["@regression"],
      },
      async ({ page }) => {
        await test.step("Open settings", async () => {
          // Anti-pattern #3 — spec drives navigation directly instead of a
          // PageClass.open(). Conformance Check 7 must block.
          await page.goto("/settings");
          await expect(
            page.getByRole("heading", { name: "Settings", level: 1 }),
            "Settings heading should be visible on the page",
          ).toBeVisible();
        });

        await test.step("Save a display name", async () => {
          await page.getByLabel("Display name").fill("Alice");
          await page.getByRole("button", { name: "Save" }).click();
          // Anti-pattern #1 — hard wait carried over from the cypress
          // `cy.wait(1500)`. The qa-master architecture forbids hard waits
          // anywhere under outputs/. Conformance Check 8 must block.
          await page.waitForTimeout(1500);
          await expect(
            page.getByRole("heading", { name: /welcome,? alice/i }),
            "Welcome greeting should be visible after Save",
          ).toBeVisible();
        });
      },
    );
  },
);
