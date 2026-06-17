// Migrated from bad-playwright on 2026-06-17 by Migrator. See outputs/plans/silent-conditionals.spec.ts.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { LABEL_DASHBOARD } from "@test-data/labels";

const DASHBOARD_PATH = "/dashboard";

export class PageClassDashboard extends BasePage {
  readonly url = DASHBOARD_PATH;

  // TODO: Q1 — .welcome-banner role unknown — assumed region with accessible name /welcome/;
  //        if DOM contradicts: keep page.locator('.welcome-banner'), add comment 'Q1 unresolved'.
  //        Reviewer fallback: ask FE team to add data-testid="welcome-banner".
  readonly regionWelcomeBanner: Locator = this.page
    .getByRole("region", { name: /welcome/i })
    .describe(`[${LABEL_DASHBOARD}] Welcome banner`);

  // TODO: Q2 — .notifications-widget role unknown — assumed region with accessible name /notifications/;
  //        if DOM contradicts: keep page.locator('.notifications-widget'), add comment 'Q2 unresolved'.
  //        Reviewer fallback: ask FE team to add data-testid="notifications-widget".
  readonly regionNotificationsWidget: Locator = this.page
    .getByRole("region", { name: /notifications/i })
    .describe(`[${LABEL_DASHBOARD}] Notifications widget`);

  // TODO: Q3 — .notification-item element type unknown — assumed <li> inside <ul>/<ol>;
  //        if DOM contradicts: keep page.locator('.notification-item').first(), add comment 'Q3 unresolved'.
  //        Reviewer fallback: ask FE team to add data-testid="notification-item".
  readonly listitemFirstNotification: Locator = this.page
    .getByRole("listitem")
    .first()
    .describe(`[${LABEL_DASHBOARD}] First notification item`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.page, `[${LABEL_DASHBOARD}] dashboard URL loaded`).toHaveURL(
      /\/dashboard/,
    );
  }

  async expectWelcomeBannerVisible(): Promise<void> {
    await expect(
      this.regionWelcomeBanner,
      `[${LABEL_DASHBOARD}] welcome banner is visible`,
    ).toBeVisible();
  }

  async expectWelcomeBannerContains(pattern: RegExp | string): Promise<void> {
    await expect(
      this.regionWelcomeBanner,
      `[${LABEL_DASHBOARD}] welcome banner contains user display name`,
    ).toContainText(pattern);
  }

  async expectNotificationsWidgetVisible(): Promise<void> {
    await expect(
      this.regionNotificationsWidget,
      `[${LABEL_DASHBOARD}] notifications widget is visible`,
    ).toBeVisible();
  }

  // TODO: Q5 — click assumed to expand widget; remove this method if widget is always visible
  async openNotificationsWidget(): Promise<void> {
    await this.regionNotificationsWidget.click();
  }

  async expectFirstNotificationVisible(): Promise<void> {
    await expect(
      this.listitemFirstNotification,
      `[${LABEL_DASHBOARD}] first notification item is visible`,
    ).toBeVisible();
  }

  // TODO: Q6 — 'New order' text requires the test user to have a seeded notification;
  //        if fresh API user has no notifications, loosen to expectFirstNotificationVisible() only.
  async expectFirstNotificationContains(text: string | RegExp): Promise<void> {
    await expect(
      this.listitemFirstNotification,
      `[${LABEL_DASHBOARD}] first notification item contains expected text`,
    ).toContainText(text);
  }
}
