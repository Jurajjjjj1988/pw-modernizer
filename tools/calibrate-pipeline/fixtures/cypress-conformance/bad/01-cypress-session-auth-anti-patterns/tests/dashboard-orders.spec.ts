// Anti-pattern #2 — runtime `test` and `expect` imported from `@playwright/test`
// directly instead of `@fixtures/base.fixture`. Conformance Check 1 must block.
import { test, expect } from "@playwright/test";

test.describe(
  "Dashboard: Order management",
  { tag: ["@desktop", "@dashboard", "@orders"] },
  () => {
    test(
      "[QA-101] - Check that the dashboard lists existing orders",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Authenticated admin landing on /dashboard/orders sees at least one order row",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ page }) => {
        await test.step("Open the orders dashboard", async () => {
          // Anti-pattern #3 — spec drives navigation directly instead of a
          // PageClass.open(). Conformance Check 7 must block.
          await page.goto("/dashboard/orders");
          // Anti-pattern #1 — hard wait for the list to "settle". The qa-master
          // architecture forbids hard waits anywhere under outputs/.
          // Conformance Check 8 must block.
          await page.waitForTimeout(2000);
          await expect(
            page.getByRole("heading", { name: /orders/i }),
            "Orders heading should be visible after navigation",
          ).toBeVisible();
        });

        await test.step("Verify at least one order row is rendered", async () => {
          await expect(
            page.locator(".order-row"),
            "Order list should not be empty for the seeded admin",
          ).not.toHaveCount(0);
        });
      },
    );
  },
);
