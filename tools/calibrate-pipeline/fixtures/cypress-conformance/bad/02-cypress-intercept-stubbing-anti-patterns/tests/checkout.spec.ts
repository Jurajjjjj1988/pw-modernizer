// Anti-pattern #2 — runtime `test` and `expect` imported from `@playwright/test`
// directly instead of `@fixtures/base.fixture`. Conformance Check 1 must block.
import { test, expect } from "@playwright/test";

test.describe(
  "Checkout: Credit-card payment",
  { tag: ["@desktop", "@checkout", "@payment"] },
  () => {
    test(
      "[QA-301] - Check that a valid credit-card payment confirms the order",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting a valid card on /cart drives the user to /order-confirmed with the confirmation surface visible",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ page }) => {
        // Anti-pattern #3 — route stub declared INSIDE the spec instead of
        // the fixture barrel. qa-master §7: "Keep route stubs in a fixture
        // or browser/ helper so specs stay declarative and the same stub is
        // reused, not duplicated." The conformance validator's
        // qa-master/architecture/route-mock-in-spec check must block.
        let payCallCount = 0;
        await page.route("**/api/checkout/pay", async (route) => {
          payCallCount += 1;
          await route.fulfill({
            status: 201,
            body: JSON.stringify({ orderId: "ord_calibration" }),
            headers: { "content-type": "application/json" },
          });
        });

        await test.step("Open the cart with a seeded line item", async () => {
          await page.goto("/cart");
          // Anti-pattern #1 — hard wait carried over from the cypress
          // `cy.wait('@getCart')` alias-sync. The qa-master architecture
          // forbids hard waits anywhere under outputs/. Conformance Check 8
          // must block.
          await page.waitForTimeout(2000);
          await expect(
            page.getByRole("row"),
            "Cart should render at least one row for the seeded session",
          ).not.toHaveCount(0);
        });

        await test.step("Submit a valid card and land on the confirmation surface", async () => {
          await page.getByRole("button", { name: "Checkout" }).click();
          await page.getByLabel("Card number").fill("4242 4242 4242 4242");
          await page.getByLabel("Expiration").fill("12/30");
          await page.getByLabel("CVC").fill("123");
          await page.getByRole("button", { name: /pay/i }).click();
          await expect(
            page.getByText("Order confirmed"),
            "Order confirmed copy should appear on the confirmation page",
          ).toBeVisible();
        });

        await test.step("Verify the payment endpoint was hit exactly once", async () => {
          expect(
            payCallCount,
            "Inline-stub call counter should equal 1",
          ).toBe(1);
        });
      },
    );
  },
);
