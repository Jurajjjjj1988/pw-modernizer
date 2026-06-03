import { test as base, expect } from "@playwright/test";

type AdminFixtures = { adminPage: import("@playwright/test").Page };

const test = base.extend<AdminFixtures>({
  adminPage: async ({ browser }, use) => {
    const ctx = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await use(page);
    await ctx.close();
  },
});

test.describe("admin", () => {
  // plan:scenario=2.1
  test("views the team table @positive", async ({ adminPage }) => {
    await adminPage.getByRole("link", { name: /team/i }).click();
    await expect(adminPage.getByRole("row")).not.toHaveCount(0);
  });

  // plan:scenario=2.2
  test("opens settings @positive", async ({ adminPage }) => {
    await adminPage.getByRole("link", { name: /settings/i }).click();
    await expect(adminPage.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});
