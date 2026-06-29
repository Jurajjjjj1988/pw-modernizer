# cypress-conformance / bad / 04-cypress-login-flow-anti-patterns

Same scenario as `good/04-cypress-login-flow` but seeded with 4 anti-
patterns the pwm-blueprint validator must reject:

1. `await page.waitForTimeout(2000)` in the spec -
   `pwm-blueprint/runtime/no-hard-waits`
2. `import { test, expect } from "@playwright/test"` in the spec instead
   of the fixture barrel - `pwm-blueprint/architecture/import-source`
3. `await page.goto("/login")` driven from the spec -
   `pwm-blueprint/architecture/page-goto-in-spec`
4. Raw CSS-class chain `this.page.locator(".auth-card")` in the POM -
   `pwm-blueprint/page-object/locator-priority` (warn-severity; not pinned in
   the calibration golden because the runner invokes default mode)
