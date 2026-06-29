import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from `examples/cypress-03-intercept-stubbing/input.spec.ts`. The
 * cypress source juggled four overlapping aliases (`getCart`, `payReq`,
 * `firstPay`, `firstFail`, `retrySuccess`) for two scenarios; the pwm-blueprint
 * flow keeps route stubs OUT of specs entirely (they live in `mockPayApi`,
 * declared in the fixture barrel) and asserts on the user-perceivable result
 * — the `/order-confirmed` landing surface — instead of internal response
 * shapes.
 */
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
      async ({ checkoutPage, mockPayApi }) => {
        await test.step("Open the cart with a seeded line item", async () => {
          await checkoutPage.open();
          await expect(
            checkoutPage.arrayCartRows,
            "Cart should render at least one row for the seeded session",
          ).not.toHaveCount(0);
        });

        await test.step("Submit a valid card and land on the confirmation surface", async () => {
          await checkoutPage.payWithCard({
            number: "4242 4242 4242 4242",
            expiry: "12/30",
            cvc: "123",
          });
          await expect(
            checkoutPage.textOrderConfirmed,
            "Order confirmed copy should appear on the confirmation page",
          ).toBeVisible();
        });

        await test.step("Verify the payment endpoint was hit exactly once", async () => {
          expect(
            mockPayApi.callCount,
            "Mocked /api/checkout/pay route should fire once per checkout submit",
          ).toBe(1);
        });
      },
    );
  },
);
