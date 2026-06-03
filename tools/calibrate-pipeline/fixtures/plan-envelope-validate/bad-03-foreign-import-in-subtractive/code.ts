// Subtractive migration MUST NOT introduce foreign framework imports.
// This generated code imports Selenium which violates the rule.
import { test, expect } from "@playwright/test";
import { By, WebDriver } from "selenium-webdriver"; // FOREIGN — violation target

test.describe("submit flow", () => {
  // plan:scenario=1.1
  test("submits the form @positive", async ({ page }) => {
    await page.goto("/form");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    // unreachable but proves the import is real:
    void By;
    void ({} as WebDriver);
  });
});
