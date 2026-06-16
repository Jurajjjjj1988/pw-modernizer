# cypress-conformance / good / 04-cypress-login-flow

Migrated from `examples/cypress-01-login-flow/input.spec.ts`. The cypress
source drove a Beacon HR login + dashboard verification. Qa-master output
moves the form interaction into a `LoginPage` POM, drops `cy.intercept`
+ `cy.wait` for `page.goto` + auto-wait, and uses role/label locators.

Calibration intent: the qa-master conformance validator must accept this
as clean (zero block-severity violations).
