import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from `examples/selenium-java-01-search/input.java`. The JUnit
 * source instantiated ChromeDriver in @BeforeEach + WebDriverWait + WebElement
 * chains; pwm-blueprint delegates form interaction to ProductSearchPage and uses
 * Playwright's auto-wait.
 */
test.describe(
  "Storefront: product search",
  { tag: ["@desktop", "@search"] },
  () => {
    test(
      "[QA-301] - Check that searching a known term returns at least one result",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting 'sneakers' on the storefront search returns at least one product card",
          },
        ],
        tag: ["@smoke"],
      },
      async ({ productSearchPage }) => {
        await test.step("Open the storefront", async () => {
          await productSearchPage.open();
          await expect(
            productSearchPage.inputSearch,
            "Search input should be visible on the storefront",
          ).toBeVisible();
        });

        await test.step("Submit a known search term", async () => {
          await productSearchPage.searchFor("sneakers");
          await expect(
            productSearchPage.arrayResultCards,
            "At least one product card should render for a known term",
          ).not.toHaveCount(0);
        });
      },
    );
  },
);
