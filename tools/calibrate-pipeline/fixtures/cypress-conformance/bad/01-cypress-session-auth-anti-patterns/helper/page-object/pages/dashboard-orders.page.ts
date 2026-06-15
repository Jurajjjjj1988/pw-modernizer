import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "DashboardOrders";

/**
 * BAD version. Same scenario as good/01 but seeded with anti-pattern #4:
 * the order-row locator is a raw `.locator('.order-row')` CSS class — the
 * cypress `cy.get('.order-row')` selector was migrated verbatim instead of
 * being lifted to `getByRole('row')` per qa-master selector priority. The
 * conformance validator's W5 (locator-priority) must flag this row.
 */
export class PageClassDashboardOrders extends BasePage {
  readonly url = "/dashboard/orders";

  readonly textOrdersHeading = this.page
    .getByRole("heading", { name: /orders/i })
    .describe(`[${LABEL}] Orders heading`);

  // Anti-pattern #4 — raw CSS class survives from the cypress source.
  readonly arrayOrderRows = this.page
    .locator(".order-row")
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

  async openFirstOrder(): Promise<void> {
    const firstRow = this.arrayOrderRows.first();
    await firstRow.click();
    await expect(
      this.page,
      `[${LABEL}] Clicking the first order should navigate to /dashboard/orders/ord_<id>`,
    ).toHaveURL(/\/dashboard\/orders\/ord_[a-z0-9]+/);
  }
}
