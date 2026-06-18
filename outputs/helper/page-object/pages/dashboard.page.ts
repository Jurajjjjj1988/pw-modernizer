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
}
