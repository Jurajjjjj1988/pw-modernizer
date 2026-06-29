import { test, expect } from "@fixtures/base.fixture";

/**
 * GOOD fixture (b): the spec uses the best-effort `.catch(() => {})` idiom on a
 * cleanup call. The widened W2 check keys off a LINE-START `try {`, so this
 * chained `.catch()` is NOT a try-block and must stay clean (exit 0). Proves the
 * widening did not over-trigger on the legitimate promise-rejection-swallow form.
 */
test.describe("Cart", () => {
  test("[QA-3] - Check that an item lands in the cart", async ({ cartPage }) => {
    await cartPage.open();
    await cartPage.addFirstItem().catch(() => {});
    await expect(cartPage.textBadgeCount, "[Cart] badge shows one item").toHaveText("1");
  });
});
