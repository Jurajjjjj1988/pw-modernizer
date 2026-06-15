# good / 01-cypress-session-auth

Represents the qa-master Stage 2 output a clean migration of
`examples/cypress-04-session-auth/input.spec.ts` should produce. The cypress
source re-ran `cy.session('admin', …, { cacheAcrossSpecs: true })` plus
`cy.clearCookies()` / `cy.clearLocalStorage()` in `beforeEach` and used CSS
selectors (`#email`, `.order-list`, `.order-row`) throughout. This "good"
version replaces the per-spec login dance with project-level `storageState`
authentication (configured at the playwright-config layer, not visible in
this fixture), models the orders dashboard as a `PageClassDashboardOrders`
that extends `BasePage` (no own constructor, `readonly` locator fields with
`.describe()` labels, navigation owned by `open()`), routes `test`/`expect`
through `@fixtures/base.fixture`, names tests as
`[QA-101] - Check that …`, and pairs every `test.step()` action with a
web-first assertion. It is the calibration target the conformance validator
must accept as clean.
