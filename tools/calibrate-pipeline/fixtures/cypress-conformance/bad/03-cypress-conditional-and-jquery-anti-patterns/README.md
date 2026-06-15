# bad / 03-cypress-conditional-and-jquery-anti-patterns

Same `cypress-05-conditional-and-jquery` scenario as the good pair,
deliberately seeded with four anti-patterns the qa-master conformance
validator (`scripts/validate-qa-master-conformance.ts`) must reject. (1)
`await page.waitForTimeout(1500)` in the spec — `qa-master/runtime/no-hard-waits`,
caught by Check 8; carried over verbatim from the cypress `cy.wait(1500)`
after Save. (2) `import { test, expect } from '@playwright/test'` in the
spec instead of `@fixtures/base.fixture` —
`qa-master/architecture/import-source`, caught by Check 1. (3)
`page.goto('/settings')` driven from the spec instead of via
`PageClassSettings.open()` — `qa-master/architecture/page-goto-in-spec`,
caught by Check 7. (4) A raw `this.page.locator('.theme-preview')` CSS-class
selector in the page object instead of `getByRole('region', { name: 'Theme
preview' })` per selector priority — `qa-master/page-object/locator-priority`,
caught by W5 (warn in default mode, block under `--strict`). This is the
calibration target the validator must reject; a passing run on this fixture
means the validator is silently broken.
