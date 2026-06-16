// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/ExplicitWaitJupiterTest.java.md for plan and rationale.

import { test } from "@fixtures/base.fixture";

test.describe("Loading Images page", () => {
  // plan:scenario=1.1
  test(
    "displays landscape image with correct src after async load",
    { tag: ["@positive", "@e2e"] },
    async ({ loadingImagesPage }) => {
      await test.step("navigate to the loading-images demo page", async () => {
        await loadingImagesPage.open();
      });

      await test.step("landscape photograph appears and has correct src attribute", async () => {
        await loadingImagesPage.expectLandscapeImageHasCorrectSrc();
      });
    },
  );
});
