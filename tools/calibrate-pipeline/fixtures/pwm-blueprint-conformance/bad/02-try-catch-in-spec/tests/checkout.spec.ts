import { test, expect } from "@fixtures/base.fixture";

/**
 * BAD fixture (b): the spec wraps an action in `try { ... } catch` to swallow a
 * flake. W2 (no-try-catch) historically scanned ONLY page/block files, so this
 * spec-level smell slipped through. Widened W2 now scans specs (+ actions) too;
 * run with --block-defects, the try/catch defect blocks the pipeline (exit 1).
 */
test.describe("Checkout", () => {
  test("[QA-7] - Check that the order completes", async ({ checkoutPage }) => {
    try {
      await checkoutPage.placeOrder();
    } catch {
      // swallow the flake — exactly the anti-pattern W2 forbids
    }
    await expect(checkoutPage.textConfirmation, "[Checkout] order confirmed").toBeVisible();
  });
});
