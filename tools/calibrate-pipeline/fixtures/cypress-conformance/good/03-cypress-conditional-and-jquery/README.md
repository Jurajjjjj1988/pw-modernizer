# good / 03-cypress-conditional-and-jquery

Represents the pwm-blueprint Stage 2 output a clean migration of
`examples/cypress-05-conditional-and-jquery/input.spec.ts` should produce.
The cypress source did three things the pwm-blueprint architecture refuses to
copy verbatim: (a) probed `cy.get('body').then(($body) => if-present)` to
conditionally dismiss a cookie banner — pwm-blueprint pre-seeds the
`cookies_accepted` cookie in the spec's `beforeEach` so the conditional
disappears entirely; (b) read DOM internals via `cy.get('html').then(($html)
=> $html.attr('data-theme'))` jQuery escape — pwm-blueprint replaces this with
`await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')`;
(c) asserted on a Redux store via `cy.window().its('app.store').invoke('getState')`
— pwm-blueprint asserts on user-perceivable surface (the welcome heading) instead
of internal state. This "good" version models the settings surface as a
`PageClassSettings` that extends `BasePage` (no own constructor, `readonly`
locator fields with `.describe()` labels, navigation owned by `open()`),
routes `test`/`expect` through `@fixtures/base.fixture`, names tests as
`[QA-501] - Check that …`, and replaces every `cy.wait(N)` with web-first
auto-waiting assertions. It is the calibration target the conformance
validator must accept as clean.
