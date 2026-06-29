// See outputs/plans/test_x.py.md
import { test, expect } from "@playwright/test";

/**
 * BAD fixture (a): the migration's input is `test_x.py`, but the LLM free-named
 * the emitted spec `x.spec.ts`. The validator's pure-basename scoping (local
 * expectedSpecBasenames → `test-x.spec.ts`) does NOT match this filename, so the
 * historical behaviour found 0 specs and passed VACUOUSLY — never seeing the
 * planted `@playwright/test` import below. With the fail-closed + provenance
 * recovery, `findGeneratedSpec` resolves THIS spec (its header cites
 * outputs/plans/test_x.py.md), the import violation fires, and the run exits 1.
 */
test.describe("Auth", () => {
  test("[QA-9] - Check that the user can sign in", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/login/);
  });
});
