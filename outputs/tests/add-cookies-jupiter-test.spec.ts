// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/AddCookiesJupiterTest.java.md for plan and rationale.
import { test, expect } from "@fixtures/base.fixture";

const COOKIE_NAME = "new-cookie-key";
const COOKIE_VALUE = "new-cookie-value";

test.describe("Cookies Demo: Add Cookies", () => {
  // plan:scenario=1.1
  test(
    "adds a cookie and verifies it appears on the page after refresh @positive",
    async ({ addCookiesPage, page }) => {
      await test.step("navigate to the cookies demo page", async () => {
        await addCookiesPage.open();
      });

      await test.step("add cookie to browser context and verify it is stored", async () => {
        // Q1: page.url() captures the resolved domain after navigation; Playwright's
        // addCookies() requires an explicit domain or url (unlike Selenium's implicit scoping).
        await page.context().addCookies([{ name: COOKIE_NAME, value: COOKIE_VALUE, url: page.url() }]);
        const cookies = await page.context().cookies();
        const stored = cookies.find((c) => c.name === COOKIE_NAME);
        // Q4: secondary API-level assertion — not web-first (reads resolved promise value, not
        // a Locator state); retained to confirm the browser stored what addCookies() was given.
        expect(stored?.value).toBe(COOKIE_VALUE);
      });

      await test.step("click Refresh cookies and confirm the new cookie is visible on page", async () => {
        await addCookiesPage.clickRefreshCookies();
        await addCookiesPage.expectNewCookieVisible();
      });
    }
  );
});
