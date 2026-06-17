// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/AddCookiesJupiterTest.java.md for plan and rationale.
import { expect, type Locator } from "@playwright/test";

import { BasePage } from "@page-object/basepage";

const LABEL = "AddCookies";

export class AddCookiesPage extends BasePage {
  // Q6: this SUT requires MIGRATION_TARGET_URL at runtime; the project
  // baseURL defaults to http://localhost:3000 which won't resolve this
  // path. Recipe to run against the upstream demo SUT:
  //   MIGRATION_TARGET_URL=https://bonigarcia.dev npx playwright test add-cookies
  readonly url = "/selenium-webdriver-java/cookies.html";

  // Mechanical By.id("refresh-cookies") → CSS-ID translation per KB §6 Rule 1.
  // TODO: Q2 unresolved — if DOM confirms <button> with accessible name "Refresh cookies",
  //   upgrade to: this.page.getByRole('button', { name: /refresh cookies/i })
  readonly buttonRefreshCookies: Locator = this.page
    .locator("#refresh-cookies")
    .describe(`[${LABEL}] Refresh cookies button`);

  // Q5 unresolved: DOM structure of cookies.html not confirmed without live
  // inspection. The cookie list renders inside a table — scope the locator to
  // the table so a doc snippet elsewhere on the page can't satisfy the assert.
  // Reviewer fallback: replace with getByRole('cell', { name: 'new-cookie-key' })
  // if inspection confirms <td> with that exact text.
  readonly textNewCookieKey: Locator = this.page
    .locator("#cookies-table")
    .getByText("new-cookie-key")
    .describe(`[${LABEL}] New cookie key cell inside #cookies-table after Refresh`);

  async waitForPageLoad(): Promise<void> {
    await expect(
      this.buttonRefreshCookies,
      `[${LABEL}] Refresh cookies button should be visible after page load`
    ).toBeVisible();
  }

  async clickRefreshCookies(): Promise<void> {
    await this.buttonRefreshCookies.click();
  }

  async expectNewCookieVisible(): Promise<void> {
    await expect(
      this.textNewCookieKey,
      `[${LABEL}] new-cookie-key should be visible in the cookie list after Refresh`
    ).toBeVisible();
  }
}
