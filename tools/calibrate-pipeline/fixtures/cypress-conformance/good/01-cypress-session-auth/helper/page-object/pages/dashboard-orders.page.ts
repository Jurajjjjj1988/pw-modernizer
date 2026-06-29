import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "DashboardOrders";

/**
 * Admin order-management dashboard. Migrated from `cypress-04-session-auth`:
 * the cypress source landed on `/dashboard/orders` after a `cy.session()`
 * cache-then-clear pre-amble; the pwm-blueprint flow assumes the context is
 * already authenticated via `storageState` (produced once by global-setup)
 * and only navigates here.
 *
 * Locators use role/text per pwm-blueprint selector priority — the cypress
 * source's `.order-list` / `.order-row` CSS classes are abandoned in favour
 * of `getByRole('region'|'row')`, matching the expected-output golden
 * in `examples/cypress-04-session-auth/expected-output.spec.ts`.
 */
export class PageClassDashboardOrders extends BasePage {
  readonly url = "/dashboard/orders";

  readonly textOrdersHeading = this.page
    .getByRole("heading", { name: /orders/i })
    .describe(`[${LABEL}] Orders heading`);

  readonly arrayOrderRows = this.page
    .getByRole("row")
    .describe(`[${LABEL}] Order rows`);

  readonly textOrderDetails = this.page
    .getByText("Order details")
    .describe(`[${LABEL}] Order details surface`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.textOrdersHeading,
      `[${LABEL}] Orders heading should be visible on the dashboard`,
    ).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Open the first order row in the list. Asserts the navigation landed on a
   * canonical order URL so the method does not end on `.click()`.
   */
  async openFirstOrder(): Promise<void> {
    const firstRow = this.arrayOrderRows.first();
    await firstRow.click();
    await expect(
      this.page,
      `[${LABEL}] Clicking the first order should navigate to /dashboard/orders/ord_<id>`,
    ).toHaveURL(/\/dashboard\/orders\/ord_[a-z0-9]+/);
  }
}
