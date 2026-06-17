// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/PromptJupiterTest.java.md for plan and rationale.

import { test, expect } from "@fixtures/base.fixture";

const EXPECTED_PROMPT_MESSAGE = "Please enter your name";
const PROMPT_INPUT_TEXT = "John Doe";

test.describe("Prompt dialog", () => {
  // plan:scenario=1.1
  test(
    "[PJT-1] - Check that a browser prompt dialog accepts input and shows the expected message",
    { tag: "@positive" },
    async ({ promptJupiterPage }) => {
      await test.step("open the dialog-boxes demo page", async () => {
        await promptJupiterPage.open();
      });

      await test.step("trigger the prompt dialog and capture its message", async () => {
        const capturedMessage = await promptJupiterPage.openAndAcceptPrompt(PROMPT_INPUT_TEXT);
        // dialog.message() is a transient event value, not a Locator state — not web-first.
        // See report §Metrics for web-first rate note (generate.md rule 12).
        expect(capturedMessage, "[PromptJupiter] prompt message should equal the expected value").toBe(
          EXPECTED_PROMPT_MESSAGE
        );
      });

      await test.step("the entered name appears in the page body after dialog acceptance", async () => {
        // TODO: Q3 unresolved — post-dialog DOM assertion inferred from bonigarcia demo behavior.
        // The demo typically renders the entered name in the page body after prompt.accept().
        // Reviewer must confirm the actual observable DOM change on the target SUT before merge.
        await expect(
          promptJupiterPage.byResultText(PROMPT_INPUT_TEXT),
          "[PromptJupiter] entered name should be visible after dialog acceptance"
        ).toBeVisible();
      });
    }
  );

  // plan:scenario=1.2
  test(
    "[PJT-2] - Check that a browser prompt dialog accepts input via wait-and-assign variant",
    { tag: "@positive" },
    async ({ promptJupiterPage }) => {
      // Behavioral duplicate of 1.1 — the Selenium API distinction (two-step switchTo() vs
      // one-step wait.until() returning Alert) disappears entirely in Playwright's
      // page.once('dialog', ...) model. See plan Q1 for consolidation recommendation;
      // reviewer may delete this block if they choose to merge the two scenarios.
      await test.step("open the dialog-boxes demo page", async () => {
        await promptJupiterPage.open();
      });

      await test.step("trigger the prompt dialog and capture its message", async () => {
        const capturedMessage = await promptJupiterPage.openAndAcceptPrompt(PROMPT_INPUT_TEXT);
        expect(capturedMessage, "[PromptJupiter] prompt message should equal the expected value").toBe(
          EXPECTED_PROMPT_MESSAGE
        );
      });

      await test.step("the entered name appears in the page body after dialog acceptance", async () => {
        // TODO: Q3 unresolved — post-dialog DOM assertion inferred from bonigarcia demo behavior.
        await expect(
          promptJupiterPage.byResultText(PROMPT_INPUT_TEXT),
          "[PromptJupiter] entered name should be visible after dialog acceptance"
        ).toBeVisible();
      });
    }
  );
});
