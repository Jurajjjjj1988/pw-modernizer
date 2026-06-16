// Migrated from selenium-java on 2026-06-16 by Migrator. See outputs/plans/FluentWaitJupiterTest.java.md for plan.

import { test } from "@fixtures/base.fixture";

test.describe("Loading images", () => {
  // plan:scenario=1.1
  test(
    "waits for the landscape image to load and verifies its source attribute @positive @e2e @slow",
    async ({ loadingImagesPage }) => {
      await test.step("open the loading images demo page", async () => {
        await loadingImagesPage.open();
      });

      await test.step("landscape image src attribute contains 'landscape'", async () => {
        await loadingImagesPage.expectLandscapeImageLoaded();
      });
    },
  );
});
