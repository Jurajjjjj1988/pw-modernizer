// Anti-pattern #2 — runtime `test` and `expect` imported from `@playwright/test`
// directly instead of `@fixtures/base.fixture`. Conformance Check 1 must block.
import { test, expect } from "@playwright/test";

test.describe(
  "Keystone Admin: Invite-user modal validation",
  { tag: ["@desktop", "@keystone-admin", "@invite-modal"] },
  () => {
    test(
      "[QA-401] - Check that an invalid email surfaces an inline validation error",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting `not-an-email` in the invite-user modal renders the inline `Please enter a valid email` error",
          },
        ],
        tag: ["@regression"],
      },
      async ({ page }) => {
        await test.step("Open the users page and trigger the invite modal", async () => {
          // Anti-pattern #3 — spec drives navigation directly instead of a
          // PageClass.open(). Conformance Check 7 must block. The
          // selenium source's `driver.get("https://admin.keystone.test/users")`
          // was migrated verbatim instead of being lifted into a page
          // object's `open()`.
          await page.goto("/users");
          // Anti-pattern #1 (first occurrence) — hard wait carried over
          // from the selenium `time.sleep(1)` after the navigation. The
          // qa-master architecture forbids hard waits anywhere under
          // outputs/. Conformance Check 8 must block.
          await page.waitForTimeout(1000);
          await page.getByRole("button", { name: "Invite" }).click();
          // Anti-pattern #1 (second occurrence) — the source slept after
          // every click; the migration carried the second `time.sleep(1)`
          // through too, doubling the silent-flake surface. Conformance
          // Check 8 must still block this.
          await page.waitForTimeout(1000);
          await expect(
            page.getByRole("dialog", { name: "Invite a new user" }),
            "Invite-user dialog should be visible after clicking Invite",
          ).toBeVisible();
        });

        await test.step("Submit an invalid email and verify the inline error", async () => {
          const dialog = page.getByRole("dialog", {
            name: "Invite a new user",
          });
          await dialog.getByLabel("Email").fill("not-an-email");
          await dialog.getByRole("button", { name: "Send invite" }).click();
          await expect(
            dialog.getByText("Please enter a valid email"),
            "Inline validation error should explain the email format requirement",
          ).toHaveText("Please enter a valid email");
        });
      },
    );
  },
);
