// Migrated from selenium-python on 2026-06-16 by Migrator.
// See outputs/plans/using_selenium_tests.py.md for plan and rationale.
import { test } from "@fixtures/base.fixture";

const INPUT_TEXT = "Selenium";

test.describe("Web form submission", () => {
  // plan:scenario=1.1
  test("submits web form text input and receives confirmation @positive", async ({ webFormPage }) => {
    await test.step("open the web form page", async () => {
      await webFormPage.open();
    });

    await test.step("page title equals 'Web form'", async () => {
      await webFormPage.expectPageTitle();
    });

    await test.step("fill the text input and submit the form", async () => {
      await webFormPage.fillTextInput(INPUT_TEXT);
      await webFormPage.clickSubmit();
    });

    await test.step("confirmation message displays 'Received!'", async () => {
      await webFormPage.expectConfirmationMessage();
    });
  });
});
