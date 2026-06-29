# bad / 01-selenium-python-pytest-login-anti-patterns

Same `selenium-python-01-login` scenario as the good pair, deliberately
seeded with four anti-patterns the pwm-blueprint conformance validator
(`scripts/validate-pwm-blueprint-conformance.ts`) must reject as block-severity
violations. (1) `await page.waitForTimeout(2000)` in the spec —
`pwm-blueprint/runtime/no-hard-waits`, caught by Check 8; carried over verbatim
from the selenium `time.sleep(2)` after the form submit (the project's #1
silent flake source). (2) `import { test, expect } from '@playwright/test'`
in the spec instead of `@fixtures/base.fixture` —
`pwm-blueprint/architecture/import-source`, caught by Check 1 (the
single-import-source rule). (3) `page.goto('/login')` driven from the spec
instead of via `PageClassLogin.open()` —
`pwm-blueprint/architecture/page-goto-in-spec`, caught by Check 7. (4) A raw
`this.page.locator('.kpi-card')` CSS-class selector in the page object
instead of `getByRole('region', { name: 'Team members' })` per selector
priority — `pwm-blueprint/page-object/locator-priority`, caught by W5 (warn in
default mode, block under `--strict`). This is the calibration target the
validator must reject; a passing run on this fixture means the validator is
silently broken.
