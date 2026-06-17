// Migrated from bad-playwright on 2026-06-17 by Migrator.
// See outputs/plans/force-clicks.spec.ts.md for plan and rationale.
import { expect, type Locator } from '@playwright/test';

import { BasePage } from '@page-object/basepage';
import { LABEL_DASHBOARD } from '@test-data/labels';

export class PageClassDashboard extends BasePage {
  readonly url = '/dashboard';

  readonly arrayNavLinks: Locator = this.page
    .getByRole('navigation')
    .getByRole('link')
    .describe(`[${LABEL_DASHBOARD}] Navigation links`);
  readonly headingWelcome: Locator = this.page
    .getByRole('heading', { name: /welcome back/i })
    .describe(`[${LABEL_DASHBOARD}] Welcome back heading`);
  readonly buttonLogout: Locator = this.page
    .getByRole('button', { name: 'Logout' })
    .describe(`[${LABEL_DASHBOARD}] Logout button`);

  async waitForPageLoad(): Promise<void> {
    await expect(this.headingWelcome, `[${LABEL_DASHBOARD}] welcome heading visible after login`).toBeVisible();
  }

  async expectNavLinksCount(count: number): Promise<void> {
    await expect(this.arrayNavLinks, `[${LABEL_DASHBOARD}] navigation link count`).toHaveCount(count);
  }

  async expectWelcomeContains(name: string): Promise<void> {
    await expect(this.headingWelcome, `[${LABEL_DASHBOARD}] welcome heading contains name`).toContainText(name);
  }

  async expectLogoutVisible(): Promise<void> {
    await expect(this.buttonLogout, `[${LABEL_DASHBOARD}] Logout button visible`).toBeVisible();
  }
}
