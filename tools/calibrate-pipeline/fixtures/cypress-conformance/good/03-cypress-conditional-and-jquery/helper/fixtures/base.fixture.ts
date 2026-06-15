import { test as base, expect } from "@playwright/test";

import { PageClassSettings } from "@page-object/pages/settings.page";

/**
 * Per-migration extension of the qa-master base fixture. This is the ONLY
 * file in the cypress-conditional-and-jquery migration permitted to import
 * `test` from `@playwright/test` — every spec imports from
 * `@fixtures/base.fixture` (this barrel) instead.
 *
 * The `acceptCookies` fixture pre-seeds the `cookies_accepted` cookie so the
 * cypress source's `if ($body.find('.cookie-banner'))` conditional UI probe
 * disappears entirely — the banner never renders, so no test needs to
 * dismiss it. This is the qa-master pattern for handling "may-or-may-not-be-
 * present" UI: pre-set the state instead of branching on it.
 */
type Fixtures = {
  acceptCookies: void;
  settingsPage: PageClassSettings;
};

const test = base.extend<Fixtures>({
  acceptCookies: [
    async ({ context }, use) => {
      await context.addCookies([
        { name: "cookies_accepted", value: "1", domain: "localhost", path: "/" },
      ]);
      await use();
    },
    { auto: true },
  ],
  settingsPage: async ({ page }, use) => use(new PageClassSettings(page)),
});

export { test, expect };
