// Migrated from selenium-python on 2026-06-16 by Migrator.
// See outputs/plans/using_selenium_tests.py.md for plan and rationale.
import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { WEB_FORM_PATH } from "@test-data/urls";

const LABEL = "WebForm";

export class PageClassWebForm extends BasePage {
  readonly url = WEB_FORM_PATH;

  // TODO: Q1 unresolved — label text not confirmed for name="my-text"; "Text input" assumed from web-form convention. Fallback: this.page.locator('[name="my-text"]'). See pin 1.
  readonly inputText: Locator = this.page
    .getByLabel(/text input/i)
    .describe(`[${LABEL}] text input field`);

  // TODO: Q2 unresolved — submit button accessible name not confirmed; "Submit" assumed from form semantics. Fallback: this.page.locator('button[type="submit"]'). See pin 2.
  readonly buttonSubmit: Locator = this.page
    .getByRole("button", { name: /submit/i })
    .describe(`[${LABEL}] submit button`);

  // CSS id is high-confidence per plan; upgrade to getByRole if element carries role="status" or role="alert" (Q3).
  readonly locatorMessage: Locator = this.page
    .locator("#message")
    .describe(`[${LABEL}] confirmation message`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.inputText, `[${LABEL}] text input ready`).toBeVisible();
  }

  async expectPageTitle(): Promise<void> {
    await expect(this.page, `[${LABEL}] page title`).toHaveTitle("Web form");
  }

  async fillTextInput(text: string): Promise<void> {
    await this.inputText.fill(text);
  }

  async clickSubmit(): Promise<void> {
    await this.buttonSubmit.click();
    await expect(this.locatorMessage, `[${LABEL}] confirmation message visible after submit`).toBeVisible();
  }

  async expectConfirmationMessage(): Promise<void> {
    await expect(this.locatorMessage, `[${LABEL}] confirmation text`).toHaveText("Received!");
  }
}
