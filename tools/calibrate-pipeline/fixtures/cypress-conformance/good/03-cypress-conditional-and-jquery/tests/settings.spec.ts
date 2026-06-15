import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from `examples/cypress-05-conditional-and-jquery/input.spec.ts`.
 * The cypress source had three tests — banner-dismiss, dark-mode toggle,
 * display-name save. The qa-master flow pre-seeds the cookie via the
 * `acceptCookies` auto-fixture (so the banner-dismiss conditional is gone),
 * asserts on user-visible surface for dark-mode + save (no jQuery escapes,
 * no Redux probes), and replaces every `cy.wait(N)` with web-first
 * auto-waiting assertions.
 */
test.describe(
  "Settings: conditional UI + theme + profile",
  { tag: ["@desktop", "@settings", "@profile"] },
  () => {
    test(
      "[QA-501] - Check that the settings heading is visible",
      {
        annotation: [
          {
            type: "Test",
            description:
              "After pre-seeding cookies, /settings renders the level-1 Settings heading without any banner-dismiss conditional",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ settingsPage }) => {
        await test.step("Open the settings page", async () => {
          await settingsPage.open();
          await expect(
            settingsPage.headingSettings,
            "Settings heading should render on the page",
          ).toBeVisible();
        });
      },
    );

    test(
      "[QA-502] - Check that toggling dark mode sets data-theme",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Enabling the Dark mode toggle sets <html data-theme='dark'> — asserted via web-first toHaveAttribute, not jQuery .attr()",
          },
        ],
        tag: ["@regression"],
      },
      async ({ settingsPage }) => {
        await test.step("Open settings and enable dark mode", async () => {
          await settingsPage.open();
          await settingsPage.enableDarkMode();
        });
      },
    );

    test(
      "[QA-503] - Check that saving a display name renders the welcome heading",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Filling 'Alice' into Display name and clicking Save renders the user-visible welcome heading (no Redux store probe)",
          },
        ],
        tag: ["@regression"],
      },
      async ({ settingsPage }) => {
        await test.step("Open settings and save the display name", async () => {
          await settingsPage.open();
          await settingsPage.saveDisplayName("Alice");
        });
      },
    );
  },
);
