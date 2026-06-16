# cypress-conformance / bad / 04-cypress-login-flow-anti-patterns

Same scenario as `good/04-cypress-login-flow` but seeded with 4 anti-
patterns the qa-master validator must reject:

1. `await page.waitForTimeout(2000)` in the spec -
   `qa-master/runtime/no-hard-waits`
2. `import { test, expect } from "@playwright/test"` in the spec instead
   of the fixture barrel - `qa-master/architecture/import-source`
3. `await page.goto("/login")` driven from the spec -
   `qa-master/architecture/page-goto-in-spec`
4. Raw CSS-class chain `this.page.locator(".auth-card")` in the POM -
   `qa-master/page-object/locator-priority` (warn-severity; not pinned in
   the calibration golden because the runner invokes default mode)
