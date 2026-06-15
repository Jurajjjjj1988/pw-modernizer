# bad / 03-selenium-python-explicit-wait-anti-patterns

Same `selenium-python-03-multifile-login` scenario as the good pair,
deliberately seeded with four anti-patterns the qa-master conformance
validator (`scripts/validate-qa-master-conformance.ts`) must reject. (1)
`await page.waitForTimeout(5000)` in the spec — `qa-master/runtime/no-hard-waits`,
caught by Check 8; carried over verbatim from the selenium `WebDriverWait(5)`
ceremony (the migrator mistranslated the explicit wait into a fixed sleep
instead of dropping it for web-first auto-waiting). (2) `import { test, expect }
from '@playwright/test'` in the spec instead of `@fixtures/base.fixture` —
`qa-master/architecture/import-source`, caught by Check 1. (3)
`page.goto('/sign-in')` driven from the spec instead of via
`PageClassLogin.open()` — `qa-master/architecture/page-goto-in-spec`,
caught by Check 7. (4) A raw `this.page.locator('.form-error')` CSS-class
selector in the page object instead of `getByRole('alert')` per selector
priority — `qa-master/page-object/locator-priority`, caught by W5 (warn in
default mode, block under `--strict`). This is the calibration target the
validator must reject; a passing run on this fixture means the validator is
silently broken.
