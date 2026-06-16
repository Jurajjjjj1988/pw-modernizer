// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/ExplicitWaitJupiterTest.java.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { LOADING_IMAGES_PAGE } from "@test-data/urls";

const LABEL = "LoadingImages";
// Q5: source used 10s WebDriverWait; preserve that budget to avoid CI flake on slow runners
const IMAGE_LOAD_TIMEOUT_MS = 10_000;

export class PageClassLoadingImages extends BasePage {
  readonly url = LOADING_IMAGES_PAGE;

  // Q1 unresolved: no DOM evidence of alt attribute on <img id="landscape">; CSS id used per plan
  readonly imageLandscape: Locator = this.page
    .locator("#landscape")
    .describe(`[${LABEL}] Landscape image`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.page, `[${LABEL}] loading-images URL reached`).toHaveURL(/loading-images/);
  }

  async expectLandscapeImageHasCorrectSrc(): Promise<void> {
    // Q5: 10s timeout preserves the WebDriverWait budget from the source — see plan risk callout
    await expect(
      this.imageLandscape,
      `[${LABEL}] landscape image src contains 'landscape'`,
    ).toHaveAttribute("src", /landscape/i, { timeout: IMAGE_LOAD_TIMEOUT_MS });
  }
}
