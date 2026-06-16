// Migrated from selenium-java on 2026-06-16 by Migrator. See outputs/plans/FluentWaitJupiterTest.java.md for plan.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "LoadingImages";

const LOADING_IMAGES_PATH = "/selenium-webdriver-java/loading-images.html";

export class PageClassLoadingImages extends BasePage {
  readonly url = LOADING_IMAGES_PATH;

  // Q3 unresolved — alt text inferred from element id and bonigarcia demo conventions; not confirmed by DOM inspection
  readonly imageLandscape: Locator = this.page
    .getByAltText(/landscape/i)
    .describe(`[${LABEL}] Landscape image`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.imageLandscape, `[${LABEL}] Landscape image present in DOM`).toBeAttached();
  }

  async expectLandscapeImageLoaded(): Promise<void> {
    // Q2 unresolved — original FluentWait used 10 s; per-assertion override preserves original tolerance (plan Risk callout)
    await expect(
      this.imageLandscape,
      `[${LABEL}] Landscape image src attribute contains 'landscape'`,
    ).toHaveAttribute("src", /landscape/i, { timeout: 10_000 });
  }
}
