import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from `examples/cypress-04-session-auth/input.spec.ts`. The cypress
 * source re-ran `cy.session()` + cookie/localStorage clears in `beforeEach`;
 * the qa-master flow relies on a project-level `storageState` produced once
 * by global-setup, so the spec only navigates and asserts UI behaviour.
 */
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
      async ({ dashboardOrdersPage }) => {
        await test.step("Open the orders dashboard", async () => {
          await dashboardOrdersPage.open();
          await expect(
            dashboardOrdersPage.textOrdersHeading,
            "Orders heading should be visible after navigation",
          ).toBeVisible();
        });

        await test.step("Verify at least one order row is rendered", async () => {
          await expect(
            dashboardOrdersPage.arrayOrderRows,
            "Order list should not be empty for the seeded admin",
          ).not.toHaveCount(0);
        });
      },
    );

    test(
      "[QA-102] - Check that opening the first order shows order details",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Clicking the first row navigates to /dashboard/orders/ord_<id> and renders the Order details surface",
          },
        ],
        tag: ["@regression"],
      },
      async ({ dashboardOrdersPage }) => {
        await test.step("Open the orders dashboard", async () => {
          await dashboardOrdersPage.open();
          await expect(
            dashboardOrdersPage.arrayOrderRows.first(),
            "At least one order row should be present before drilling in",
          ).toBeVisible();
        });

        await test.step("Open the first order in the list", async () => {
          await dashboardOrdersPage.openFirstOrder();
          await expect(
            dashboardOrdersPage.textOrderDetails,
            "Order details surface should render after drilling in",
          ).toBeVisible();
        });
      },
    );
  },
);
