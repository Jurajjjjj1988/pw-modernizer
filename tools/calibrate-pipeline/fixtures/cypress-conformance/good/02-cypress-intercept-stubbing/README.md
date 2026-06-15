# good / 02-cypress-intercept-stubbing

Represents the qa-master Stage 2 output a clean migration of
`examples/cypress-03-intercept-stubbing/input.spec.ts` should produce. The
cypress source juggled four overlapping `cy.intercept().as()` aliases
(`getCart`, `payReq`, `firstPay`, `firstFail`, `retrySuccess`), used deep
CSS selectors (`.cart-row`, `input[name="card"]`, `button.pay-now`), and
asserted on `interception.response.body.orderId` shapes via nested
`cy.wait('@alias').then(...)` chains. This "good" version models the
cart + checkout surface as a `PageClassCheckout` that extends `BasePage`
(no own constructor, `readonly` locator fields with `.describe()` labels,
navigation owned by `open()`), declares the `/api/checkout/pay` route stub
as a `mockPayApi` fixture in `helper/fixtures/base.fixture.ts` (per
qa-master rule §7: route stubs are fixtures, not inline spec setup), routes
`test`/`expect` through `@fixtures/base.fixture`, names tests as
`[QA-301] - Check that …`, and asserts on the user-perceivable
`/order-confirmed` surface plus an exactly-once call-count assertion read
from the fixture-owned counter. It is the calibration target the
conformance validator must accept as clean.
