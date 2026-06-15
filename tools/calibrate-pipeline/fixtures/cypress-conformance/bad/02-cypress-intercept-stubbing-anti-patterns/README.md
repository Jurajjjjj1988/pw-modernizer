# bad / 02-cypress-intercept-stubbing-anti-patterns

Same `cypress-03-intercept-stubbing` scenario as the good pair, deliberately
seeded with four anti-patterns the qa-master conformance validator
(`scripts/validate-qa-master-conformance.ts`) must reject as block-severity
violations. (1) `await page.waitForTimeout(2000)` in the spec —
`qa-master/runtime/no-hard-waits`, caught by Check 8; carried over verbatim
from the cypress `cy.wait('@getCart')` alias-sync (the project's #1 silent
flake source). (2) `import { test, expect } from '@playwright/test'` in the
spec instead of `@fixtures/base.fixture` —
`qa-master/architecture/import-source`, caught by Check 1 (the
single-import-source rule). (3) The `page.route('**/api/checkout/pay', …)`
network stub declared INSIDE the spec instead of the fixture barrel —
`qa-master/architecture/route-mock-in-spec`, the qa-master §7 rule
("Keep route stubs in a fixture or `browser/` helper so specs stay
declarative and the same stub is reused, not duplicated"). The cypress
source piled four overlapping `cy.intercept().as()` aliases into the same
spec; the conformance validator must reject any spec-level `page.route`
call that imports the route stub setup. (4) A raw
`this.page.locator('.cart-row')` CSS-class selector in the page object
instead of `getByRole('row')` per selector priority —
`qa-master/page-object/locator-priority`, caught by W5 (warn in default
mode, block under `--strict`). This is the calibration target the validator
must reject; a passing run on this fixture means the validator is silently
broken.
