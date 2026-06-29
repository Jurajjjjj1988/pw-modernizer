# selenium-java-conformance / bad / 01-selenium-java-product-search-anti-patterns

Same scenario as `good/01-selenium-java-product-search` but seeded with 4
anti-patterns the pwm-blueprint validator must reject:

1. `await page.waitForTimeout(2000)` in the spec -
   `pwm-blueprint/runtime/no-hard-waits`
2. `import { test, expect } from "@playwright/test"` in the spec instead
   of the fixture barrel - `pwm-blueprint/architecture/import-source`
3. `await page.goto("/")` driven from the spec -
   `pwm-blueprint/architecture/page-goto-in-spec`
4. Raw CSS-class chain `this.page.locator(".product-card")` in the POM -
   `pwm-blueprint/page-object/locator-priority` (warn-severity; not pinned in
   the golden because the runner invokes default mode)
