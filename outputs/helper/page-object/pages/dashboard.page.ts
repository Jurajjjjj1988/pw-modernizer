// Migrated from bad-playwright on 2026-06-18 by Migrator.
// See outputs/plans/force-clicks.spec.ts.md for plan and rationale.

import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";
import { LABEL_DASHBOARD } from "@test-data/labels";

// Walk-and-Watch (2026-06-18): 5 primary nav sections confirmed — revisit if nav grows (see Q5).
const NAV_LINK_COUNT = 5;
// Extracted from source: stable test-account first name — see Q6 if display name can change.
const VALID_USER_DISPLAY_NAME = "Jane";

export class PageClassDashboard extends BasePage {
  readonly url = "/dashboard";

  readonly headingWelcome: Locator = this.page
    .getByRole("heading", { name: /welcome back/i })
    .describe(`[${LABEL_DASHBOARD}] Welcome heading`);
  readonly arrayNavLinks: Locator = this.page
    .getByRole("navigation")
    .getByRole("link")
    .describe(`[${LABEL_DASHBOARD}] Navigation links`);
  readonly buttonLogout: Locator = this.page
    .getByRole("button", { name: "Logout" })
    .describe(`[${LABEL_DASHBOARD}] Logout button`);

  // silent-conditionals migration (2026-06-18)
  // Q4 unresolved: .welcome-banner ARIA role unknown — CSS class last-resort retained, see plan pin 3.
  // Reviewer: inspect DOM for ARIA role/testid, or ask FE to add data-testid="welcome-banner".
  readonly textWelcomeBanner: Locator = this.page
    .locator(".welcome-banner")
    .describe(`[${LABEL_DASHBOARD}] Welcome banner`);

  // Q4 unresolved: .notifications-widget role assumed button (element is clicked in source). See plan pin 4.
  // If widget is not a button: fall back to locator('.notifications-widget') + WHY comment.
  readonly buttonNotificationsWidget: Locator = this.page
    .getByRole("button", { name: /notifications/i })
    .describe(`[${LABEL_DASHBOARD}] Notifications widget button`);

  // TODO: fragile selector — add testid. Q4 unresolved: .notification-item accessible role unknown — CSS class + .first() last-resort fallback, see plan pin 5.
  readonly textFirstNotification: Locator = this.page
    .locator(".notification-item")
    .first()
    .describe(`[${LABEL_DASHBOARD}] First notification item`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.headingWelcome,
      `[${LABEL_DASHBOARD}] Welcome heading visible after sign-in`
    ).toBeVisible();
  }

  async expectDashboardURL(): Promise<void> {
    await expect(this.page, `[${LABEL_DASHBOARD}] URL includes /dashboard`).toHaveURL(
      /\/dashboard/
    );
  }

  async expectNavLinkCount(): Promise<void> {
    // TODO: Q5 unresolved — NAV_LINK_COUNT assumed meaningful; drop assertion if nav grows through routine features.
    await expect(
      this.arrayNavLinks,
      `[${LABEL_DASHBOARD}] Navigation contains ${NAV_LINK_COUNT} links`
    ).toHaveCount(NAV_LINK_COUNT);
  }

  async expectWelcomeHeading(): Promise<void> {
    // TODO: Q6 unresolved — VALID_USER_DISPLAY_NAME assumed stable; swap to /welcome back/i if test-account name is mutable.
    await expect(
      this.headingWelcome,
      `[${LABEL_DASHBOARD}] Welcome heading contains user display name`
    ).toContainText(VALID_USER_DISPLAY_NAME);
  }

  async expectLogoutButtonVisible(): Promise<void> {
    await expect(
      this.buttonLogout,
      `[${LABEL_DASHBOARD}] Logout button visible confirming authenticated state`
    ).toBeVisible();
  }

  async expectWelcomeBannerVisible(): Promise<void> {
    await expect(
      this.textWelcomeBanner,
      `[${LABEL_DASHBOARD}] Welcome banner visible after authenticated dashboard load`
    ).toBeVisible();
  }

  async expectWelcomeBannerContainsName(): Promise<void> {
    // TODO: Q10 unresolved — /welcome back.*jane/i assumes "Jane" is the stable CI test-account display name; widen to /welcome back/i if profile rename is possible.
    await expect(
      this.textWelcomeBanner,
      `[${LABEL_DASHBOARD}] Welcome banner text matches user display name`
    ).toContainText(/welcome back.*jane/i);
  }

  async expectNotificationsWidgetVisible(): Promise<void> {
    await expect(
      this.buttonNotificationsWidget,
      `[${LABEL_DASHBOARD}] Notifications widget button visible before interaction`
    ).toBeVisible();
  }

  async clickNotificationsWidget(): Promise<void> {
    await this.buttonNotificationsWidget.click();
  }

  async expectNotificationItemVisible(): Promise<void> {
    await expect(
      this.textFirstNotification,
      `[${LABEL_DASHBOARD}] At least one notification item visible after widget opened`
    ).toBeVisible();
  }

  async expectFirstNotificationText(): Promise<void> {
    // TODO: Q7 unresolved — /new order/i assumes environment has pre-seeded "New order" notification; loosen to expectNotificationItemVisible() if seeding is not feasible.
    await expect(
      this.textFirstNotification,
      `[${LABEL_DASHBOARD}] First notification item contains expected text`
    ).toContainText(/new order/i);
  }
}
