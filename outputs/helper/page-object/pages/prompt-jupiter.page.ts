// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/PromptJupiterTest.java.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "PromptJupiter";

export class PageClassPromptJupiter extends BasePage {
  readonly url = "/selenium-webdriver-java/dialog-boxes.html";

  // Q2 unresolved: accessible name /prompt/i inferred from element id only — not DOM-confirmed.
  // Upgrade to page.getByRole('button', { name: /prompt/i }) once reviewer inspects the
  // accessibility tree. See plan hallucination-defense pin 1.
  readonly buttonPrompt: Locator = this.page
    .locator("#my-prompt")
    .describe(`[${LABEL}] Prompt trigger button`);

  // TODO: Q3 unresolved — result locator inferred from bonigarcia demo behavior.
  // The demo typically renders the entered name in the page body after prompt.accept().
  // Reviewer must verify the actual observable change on the target SUT before merge.
  readonly byResultText = (name: string): Locator =>
    this.page.getByText(name).describe(`[${LABEL}] Result text after dialog acceptance`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.buttonPrompt,
      `[${LABEL}] Prompt button should be visible on page load`
    ).toBeVisible();
  }

  // Registers the dialog handler BEFORE the click — critical ordering per plan risk callout.
  // Returns the captured dialog message so the spec can assert it after click() resolves.
  // capturedMessage is set synchronously inside the handler before await dialog.accept(),
  // so it is guaranteed to be defined by the time click() returns.
  async openAndAcceptPrompt(inputText: string): Promise<string> {
    let capturedMessage: string | undefined;
    this.page.once("dialog", async (dialog) => {
      capturedMessage = dialog.message();
      await dialog.accept(inputText);
    });
    await this.buttonPrompt.click();
    return capturedMessage ?? "";
  }
}
