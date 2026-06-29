# bad / 02-selenium-python-form-validation-anti-patterns

Same `selenium-python-02-modal-interaction` (third pytest test,
`test_invite_user_modal_validates_email`) scenario as the good pair,
deliberately seeded with four anti-patterns the pwm-blueprint conformance
validator (`scripts/validate-pwm-blueprint-conformance.ts`) must reject as
block-severity violations. (1) **Two** `await page.waitForTimeout(...)`
calls in the spec — `pwm-blueprint/runtime/no-hard-waits`, caught by Check 8;
both carried over verbatim from the selenium `time.sleep(1)` calls that
followed every click in the source (the project's #1 silent flake source).
Two occurrences instead of one to mirror the selenium pattern of sleeping
after both the navigation AND the click. (2) `import { test, expect } from
'@playwright/test'` in the spec instead of `@fixtures/base.fixture` —
`pwm-blueprint/architecture/import-source`, caught by Check 1 (the
single-import-source rule). (3) `page.goto('/users')` driven from the spec
instead of via `PageClassUsersAdmin.open()` —
`pwm-blueprint/architecture/page-goto-in-spec`, caught by Check 7; the selenium
source's `driver.get(...)` was migrated verbatim instead of being lifted
into the page object. (Pair #02 substitutes `page.goto`-in-spec for the
cypress pair's `route-mock-in-spec` — selenium has no analogous route stub
to migrate, the corresponding migration anti-pattern is leaving the
`driver.get(...)` navigation at the spec layer.) (4) A raw
`this.page.locator('.modal')` CSS-class selector in the page object
instead of `getByRole('dialog', { name: 'Invite a new user' })` per
selector priority — `pwm-blueprint/page-object/locator-priority`, caught by W5
(warn in default mode, block under `--strict`). This is the calibration
target the validator must reject; a passing run on this fixture means the
validator is silently broken.
