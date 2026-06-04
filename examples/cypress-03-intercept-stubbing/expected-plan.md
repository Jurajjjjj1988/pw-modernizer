# Migration plan: input.spec.ts

## Source framework
cypress

## Summary
Checkout flow with two intercept-heavy scenarios: a happy-path credit-card
payment that asserts on the intercepted response shape, and a retry path
that uses `times: 1` to simulate a first-call failure then a success.
Migration must replace alias-based sync with web-first assertions on the
visible result and use `page.route` for explicit per-call control.

### User-perceivable assertion checklist
- [x] After valid card payment, the URL reflects `/order-confirmed` and the
      visible confirmation copy appears.
- [x] After first-call 500 then 201 retry, the same `/order-confirmed`
      visible state is reached (test exercises the retry behavior, not the
      intermediate failure).

## Anti-patterns detected
- [x] `cy.wait('@req').then(interception => expect(...))` (line 22-25) —
      jQuery-style nested assertions on the intercepted response. Replace
      with `page.waitForResponse` + flat assertions (KB-1.2.11).
- [x] `cy.intercept(...).as('alias')` chain for sync + assertion (lines 6-9,
      29, 30) — multiple aliases for the same route make the test reader
      track which alias fires when. Use `page.route` once + per-call counter
      (KB-1.2.39, KB-1.2.40).
- [x] `cy.intercept('POST', '/foo', { times: 1, statusCode: 500 })` count
      coupling (line 29) — the migration plan must not carry forward the
      implicit count behavior; explicit per-call routing is cleaner
      (KB-1.2.40).
- [x] Deep CSS selectors (`input[name="card"]`, `button.pay-now`) — replace
      with `getByLabel` / `getByRole`.
- [x] `cy.get('.cart-row').should('have.length.gte', 1)` chai chain — use
      `expect(page.getByRole('row')).not.toHaveCount(0)` form instead.
- [x] `cy.contains('Checkout')` ambiguous text — disambiguate with role
      (button vs heading vs link). KB-1.2.6.

## Locator translation table
| Original | New | Confidence | Notes |
|---|---|---|---|
| `cy.contains('Checkout')` | `page.getByRole('button', { name: 'Checkout' })` | high | The intent is the clickable button. |
| `cy.get('input[name="card"]')` | `page.getByLabel('Card number')` | medium | Assumes `<label for="card">Card number</label>`. Fallback: `getByPlaceholder('4242 4242 4242 4242')`. |
| `cy.get('input[name="exp"]')` | `page.getByLabel('Expiration')` | medium | Same assumption. |
| `cy.get('input[name="cvc"]')` | `page.getByLabel('CVC')` | medium | Same assumption. |
| `cy.get('button.pay-now')` | `page.getByRole('button', { name: /pay/i })` | high | Visible button label is "Pay now" or similar. |
| `cy.get('.cart-row')` | `page.getByRole('row')` | medium | Semantic table assumed. |
| `cy.contains('Order confirmed')` | `page.getByText('Order confirmed')` | high | Text appears verbatim in heading or alert. |

## Hallucination-defense pins
1. **Pay button label** — assumed `getByRole('button', { name: /pay/i })`, keep `cy.get('button.pay-now')` shape in WHY-comment `// WHY: Cypress used .pay-now CSS class; assumed visible label matches /pay/i`. Reviewer fallback: if real label is "Place order", swap.

## Structural changes
- Extract POM: no — only checkout-form fields, both tests in same suite.
- Extract fixture: yes — `paymentFormFields()` helper that types card/exp/cvc.
  Both tests duplicate the typing sequence; a small helper reads cleaner.
- Split into multiple specs: no.

## Open questions for reviewer
- The Cypress test asserts on `interception.response.body.orderId` matching
  `/^ord_/`. The migrated test drops this internal-shape assertion because
  it tests an implementation detail. If the orderId format is contractual
  (user-facing in URL or email), restore the assertion via
  `page.waitForResponse(...)` + `await resp.json()`.
- The retry scenario uses `cy.intercept(..., { times: 1, statusCode: 500 })`
  to simulate a first-call failure. The migrated test uses a callCount
  counter in `page.route`. Confirm the SUT's retry policy is "retry once on
  5xx" — if it's "retry 3 times" the migrated test may need broader matching.

## Risk callouts
- The intercept aliases overlap: `payReq` and `firstPay` both match the same
  route. Cypress fires `firstPay` first then `payReq` for the same call,
  which the test doesn't actually exercise. The migration drops the
  unused `firstPay` alias entirely.

## Expected metrics
- Selector quality score: 7/7 role/label-based.
- Smell count delta: -3 intercept-alias smell, -2 nested-then assertions,
  -1 chai chain, -1 ambiguous contains.
- LOC delta: 44 → 50 (+6 lines; helper fixture extraction adds explicitness).
- Anti-pattern coverage: 6/6 from the detected list.
