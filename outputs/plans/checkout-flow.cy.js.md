# Migration plan: checkout-flow.cy.js

## Source framework

Cypress (`/// <reference types="cypress" />`, `describe/it` API, `cy.*` command chain). Target: Playwright TypeScript (latest stable, 2026 qa-master conventions). Additive migration — full framework translation required.

## Summary

This test exercises a Beacon Shop e-commerce checkout flow: visiting the cart page, updating a product's quantity, proceeding through the checkout payment form, and asserting the order-confirmation page. A second scenario verifies that the Checkout CTA is disabled when the user removes all cart items, leaving an empty cart. Both scenarios rely on Cypress network intercepts that spy without stubs and use hard waits and CSS-class selectors throughout.

Migration replaces `cy.intercept` spies with `page.route` stubs lifted into an `auto: true` checkout-mocks fixture, replaces all CSS/attribute selectors with role-/label-/testid-based locators, and eliminates every hard wait with web-first assertions. The output follows qa-master: three `PageClass*` POMs, a cross-page action helper, a feature-specific mocks fixture that re-exports `expect`, typed test-data constants, and external type definitions for both API payloads.

### What bug does this catch?

Catches a regression where the credit-card checkout flow silently fails to complete (broken quantity update, inaccessible payment form, rejected payment, or missing order-confirmation) OR where the Checkout CTA remains enabled on an empty cart, allowing a zero-item order to be submitted.

### User-perceivable assertion checklist

- [ ] After visiting `/cart`: cart rows collection is visible (exact count from mock)
- [ ] After updating second-row quantity to `3`: quantity input retains value `'3'` (Q13 guard — replaces `cy.wait(500)` race)
- [ ] After completing checkout: page URL matches `/order-confirmed`
- [ ] After completing checkout: "Order confirmed" heading is visible
- [ ] After completing checkout: summary-total element contains `$`
- [ ] After removing all cart items: empty-cart banner is visible
- [ ] After removing all cart items: Checkout button is disabled (semantic `toBeDisabled()`, not CSS-class check)

---

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 16–17 | KB-1.2.7 | `cy.intercept` without response stub | `cy.intercept('GET', '/api/cart').as(…)` | `page.route('**/api/cart', route => route.fulfill({…}))` lifted into `checkout-mocks.fixture.ts` with `auto: true` |
| H | 20 | KB-1.2.1 | `cy.wait(N)` hard wait | `cy.wait(800)` | Remove; `cartPage.waitForPageLoad()` asserts rows visible |
| H | 28 | KB-1.2.1 | `cy.wait(N)` hard wait | `cy.wait(500)` | Replace with `expect(byCartRowQtyInput(name)).toHaveValue(qty)` inside `updateItemQuantity` |
| H | 32–34 | KB-1.1.9 | Hardcoded payment credentials | `type('4242 4242 4242 4242') / '12/30' / '123'` | Extract to `TEST_CARD_NUMBER`, `TEST_CARD_EXPIRY`, `TEST_CARD_CVC` in `test-data/checkout.ts` |
| M | 15 | KB-1.2.13 | `cy.viewport(N, M)` magic numbers | `cy.viewport(1366, 768)` | Remove; belongs in `playwright.config.ts` desktop project viewport |
| M | 19 | KB-1.2.36 | `cy.wait('@alias')` without explicit timeout | `cy.wait('@getCart')` | Drop entirely; stub via `page.route` + `waitForPageLoad()` provides sync |
| M | 24 | KB-1.2.3 | CSS-class primary selector | `cy.get('.cart-row')` | `getByTestId('cart-row')` — see pin 1 |
| M | 26 | KB-1.2.2 | Index-based selector | `.eq(1)` | `this.cartRows.filter({ hasText: productName })` |
| M | 26 | KB-1.2.3 | CSS-class primary selector | `.find('.qty-input')` | `.getByRole('spinbutton')` — see pin 2 |
| M | 26 | KB-1.2.30 | `clear().type()` pattern | `.clear().type('3')` | `.fill('3')` — atomic, no React-state race |
| M | 27 | KB-1.2.6 | `cy.contains()` ambiguous text match | `cy.contains('Update cart').click()` | `getByRole('button', { name: /update cart/i })` — see pin 3 |
| M | 30 | KB-1.2.6 | `cy.contains()` ambiguous text match | `cy.contains('Checkout').click()` | `getByRole('button', { name: /^checkout$/i })` — see pin 4 |
| M | 32 | KB-1.2.3 | Attribute selector (not role-based) | `cy.get('input[name="card"]')` | `getByLabel(/card number/i)` — see pin 5 |
| M | 33 | KB-1.2.3 | Attribute selector (not role-based) | `cy.get('input[name="exp"]')` | `getByLabel(/expiry date\|exp/i)` — see pin 6 |
| M | 34 | KB-1.2.3 | Attribute selector (not role-based) | `cy.get('input[name="cvc"]')` | `getByLabel(/cvc\|cvv/i)` — see pin 7 |
| M | 35 | KB-1.2.3 | CSS-class primary selector | `cy.get('button.pay-now')` | `getByRole('button', { name: /pay now/i })` — see pin 8 |
| M | 37 | KB-1.2.36 | `cy.wait('@alias')` without explicit timeout | `cy.wait('@payReq')` | Drop; stub via `page.route` + UI assertion subsumes |
| M | 37–40 | KB-1.2.11 | `cy.wait('@req').then()` nested assertions | `cy.wait('@payReq').then((interception) => …)` | Drop non-user-perceivable backend assertions (statusCode, orderId); URL + heading are the user-visible oracles (see Q12) |
| M | 42 | KB-1.2.32 | URL match without pattern | `cy.url().should('include', '/order-confirmed')` | `expect(page).toHaveURL(/\/order-confirmed/)` |
| M | 43 | KB-1.2.6 | `cy.contains()` ambiguous text match | `cy.contains('Order confirmed')` | `getByRole('heading', { name: /order confirmed/i })` — see pin 9 |
| M | 44 | KB-1.2.3 | CSS-class primary selector | `cy.get('.summary-total')` | `getByTestId('summary-total')` — see pin 10 |
| M | 48 | KB-1.2.3 | CSS-class primary selector (compound) | `cy.get('.cart-row .remove-btn')` | `byRemoveButton(productName)` arrow-function field — see pin 11 |
| M | 48–50 | KB-UNCLASSIFIED | `.each()` stale NodeList iteration | `.each(($btn) => { cy.wrap($btn).click() })` | See Unclassified smells below |
| M | 52 | KB-1.2.3 | CSS-class primary selector | `cy.get('.empty-cart-banner')` | `getByRole('status')` — see pin 12 |
| M | 53 | KB-1.2.6 | `cy.contains()` ambiguous text match | `cy.contains('Checkout').parent()` | Same `buttonCheckout` locator; see pin 4 |
| L | 53 | KB-UNCLASSIFIED | CSS-class disability assertion | `.should('have.class', 'is-disabled')` | `toBeDisabled()` semantic check; see Unclassified smells below |

### Unclassified smells

**`.each()` stale NodeList iteration (lines 48–50):**
`cy.get('.cart-row .remove-btn').each(($btn) => { cy.wrap($btn).click() })` collects a snapshot of all remove-button references at resolution time. After the first click removes a cart row and the React tree re-renders, the remaining `$btn` references in the captured array can be detached from the DOM. The bug class is `StaleSnapshotAssertion` (closely related to KB-1.2.18 which covers `cy.then()` stale chains) but KB-1.2.18's specific entry is about `cy.then()` chaining syntax, not `.each()` iteration — hence KB-UNCLASSIFIED. Fix: `removeAllItems(productNames: string[])` action method calling the lazy `byRemoveButton(name)` arrow-function field per iteration; each call re-evaluates the live DOM so no reference ever goes stale.

**CSS-class disabled check (line 53):**
`cy.contains('Checkout').parent().should('have.class', 'is-disabled')` asserts that the _parent element_ carries a CSS class, not that the button itself is semantically disabled. A change from `is-disabled` class to a `disabled` HTML attribute or `aria-disabled="true"` on the button would silently pass this check while the button is fully interactive. Fix: `await expect(buttonCheckout).toBeDisabled()` — asserts the semantic disabled state, which works for HTML `disabled`, `aria-disabled="true"`, and inert-subtree patterns. This is an **intentionally stricter** assertion; see Risk callouts.

---

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `cy.get('.cart-row')` | `this.page.getByTestId('cart-row')` | low | No DOM snapshot; `.cart-row` CSS class may not correspond to `data-testid="cart-row"`. Fallback: `this.page.locator('.cart-row')`. See pin 1. |
| `cy.get('.cart-row').eq(1).find('.qty-input')` | `this.cartRows.filter({ hasText: productName }).getByRole('spinbutton')` | low | `qty-input` label unknown; `spinbutton` role assumes `<input type="number">`. Fallback: `.getByRole('textbox')` or `locator('.qty-input')`. See pin 2. |
| `cy.contains('Update cart').click()` | `this.page.getByRole('button', { name: /update cart/i })` | med | `cy.contains` suggests text is visible; assuming `<button>` element. Could be `<a>` or `<div role="button">`. See pin 3. |
| `cy.contains('Checkout').click()` | `this.page.getByRole('button', { name: /^checkout$/i })` | med | Assuming `<button>`. `^checkout$` anchored to avoid matching "Proceed to checkout" variants. See pin 4. |
| `cy.get('input[name="card"]')` | `this.page.getByLabel(/card number/i)` | low | Label text for card input unknown. If payment is inside a Stripe/Adyen iframe, requires `frameLocator`. See pin 5. |
| `cy.get('input[name="exp"]')` | `this.page.getByLabel(/expiry date\|exp/i)` | low | Label text unknown; regex covers common variants. Same iframe caveat. See pin 6. |
| `cy.get('input[name="cvc"]')` | `this.page.getByLabel(/cvc\|cvv/i)` | low | Label text unknown; regex covers common variants. Same iframe caveat. See pin 7. |
| `cy.get('button.pay-now')` | `this.page.getByRole('button', { name: /pay now/i })` | med | Element is explicitly `button`; accessible name inferred from class `.pay-now`. See pin 8. |
| `cy.contains('Order confirmed')` | `this.page.getByRole('heading', { name: /order confirmed/i })` | med | `cy.contains` suggests prominent label; assuming heading. Could be `<p>` or `<div>`. See pin 9. |
| `cy.get('.summary-total')` | `this.page.getByTestId('summary-total')` | low | CSS class may not match a `data-testid`. Fallback: `locator('.summary-total')`. See pin 10. |
| `cy.get('.cart-row .remove-btn').each(…)` | `this.cartRows.filter({ hasText: productName }).getByRole('button', { name: /remove/i })` | low | Button accessible name inferred from class `.remove-btn`. Actual label may differ. See pin 11. |
| `cy.get('.empty-cart-banner')` | `this.page.getByRole('status')` | low | CSS class `.empty-cart-banner` does not guarantee `role="status"`. Could be `role="alert"` or plain `<div>`. See pin 12. |

---

## Hallucination-defense pins

1. **Cart rows collection** — assumed `this.page.getByTestId('cart-row')`. If DOM contradicts (no `data-testid="cart-row"`): keep `this.page.locator('.cart-row')`, add WHY-comment `'Q1 unresolved: cart-row testid absent, CSS fallback'`. Reviewer fallback: ask FE team to add `data-testid="cart-row"` to every cart row element.

2. **Quantity input for a named cart row** — assumed `this.cartRows.filter({ hasText: productName }).getByRole('spinbutton')`. If DOM contradicts (qty input is `type="text"`, not `type="number"`): try `.getByRole('textbox')` first; if a visible label is present, use `.getByLabel(/qty|quantity/i)`. Add WHY-comment `'Q2 unresolved: qty input label unknown, spinbutton fallback'`. Reviewer fallback: ask FE team for input type or visible label text.

3. **"Update cart" button** — assumed `getByRole('button', { name: /update cart/i })`. If DOM contradicts (element is a link or `div[role="button"]`): fall back to `getByText(/update cart/i)`. Add WHY-comment `'Q3 unresolved: Update cart element role unknown'`. Reviewer fallback: inspect element and confirm `<button>` vs `<a>`.

4. **Checkout CTA button** — assumed `getByRole('button', { name: /^checkout$/i })`. If DOM contradicts: try `getByRole('link', { name: /^checkout$/i })` then `getByText(/^checkout$/i)`. Add WHY-comment `'Q4 unresolved: Checkout element role unknown'`. Note for `expectCheckoutButtonDisabled()`: if the button uses `aria-disabled="true"` rather than HTML `disabled`, `toBeDisabled()` still fires correctly — this is the correct semantic check. Reviewer fallback: confirm button vs link, and `aria-disabled` vs `disabled` attribute.

5. **Card number input** — assumed `getByLabel(/card number/i)`. If the payment form is inside a Stripe/Adyen/hosted-fields iframe: wrap the locator as `page.frameLocator('iframe[name*="card"]').getByLabel(/card number/i)` (or equivalent iframe selector). Add WHY-comment `'Q5 unresolved: payment form may be in iframe; label text and frame selector unconfirmed'`. Reviewer fallback: check the rendered DOM for iframe boundaries and confirm accessible label text.

6. **Expiry date input** — assumed `getByLabel(/expiry date|exp/i)`. Same iframe caveat as pin 5. Add WHY-comment `'Q5 unresolved: expiry label unknown, iframe possible'`. Reviewer fallback: same as pin 5.

7. **CVC input** — assumed `getByLabel(/cvc|cvv/i)`. Same iframe caveat as pin 5. Add WHY-comment `'Q5 unresolved: CVC label unknown, iframe possible'`. Reviewer fallback: same as pin 5.

8. **"Pay now" button** — assumed `getByRole('button', { name: /pay now/i })`. Class `.pay-now` suggests the label but the visible button text may be "Place order", "Complete purchase", or similar. Add WHY-comment `'Q6 unresolved: pay-now button accessible name unknown, inferred from CSS class'`. Reviewer fallback: inspect rendered button text and update regex accordingly.

9. **"Order confirmed" heading** — assumed `getByRole('heading', { name: /order confirmed/i })`. If no heading element: fall back to `getByText(/order confirmed/i)`. Add WHY-comment `'Q7 unresolved: Order confirmed element type unknown, heading assumed'`. Reviewer fallback: inspect DOM and switch to `getByText` if it is a paragraph or `<div>`.

10. **Summary-total element** — assumed `getByTestId('summary-total')`. If no testid: fall back to `locator('.summary-total')`. Add WHY-comment `'Q8 unresolved: summary-total testid absent, CSS fallback'`. Reviewer fallback: ask FE team to add `data-testid="summary-total"`.

11. **Remove button for a named cart row** — assumed `this.cartRows.filter({ hasText: productName }).getByRole('button', { name: /remove/i })`. Button label inferred from CSS class `.remove-btn`; actual accessible name may be "Remove", "Delete", "×", or an icon with `aria-label`. Add WHY-comment `'Q9 unresolved: remove-button accessible name inferred from class'`. Reviewer fallback: inspect the DOM for button text or `aria-label`.

12. **Empty-cart banner** — assumed `getByRole('status')`. If DOM has no `role="status"`: try `getByRole('alert')`, then `getByTestId('empty-cart-banner')`, then `locator('.empty-cart-banner')`. Add WHY-comment `'Q10 unresolved: empty-cart-banner ARIA role unknown'`. Reviewer fallback: ask FE team to add `role="status"` or a stable `data-testid`.

---

## Structural changes

### Pages

**`outputs/helper/page-object/pages/cart.page.ts`** — `PageClassCart extends BasePage`

No own constructor. Locator fields (all `readonly`, each `.describe('[Cart] …')`):

| Field | Type | Target locator |
|---|---|---|
| `cartRows` | static | `getByTestId('cart-row')` — pin 1 |
| `buttonUpdateCart` | static | `getByRole('button', { name: /update cart/i })` — pin 3 |
| `buttonCheckout` | static | `getByRole('button', { name: /^checkout$/i })` — pin 4 |
| `textEmptyCartBanner` | static | `getByRole('status')` — pin 12 |
| `byCartRowQtyInput` | **readonly arrow-function field** | `(productName: string) => this.cartRows.filter({ hasText: productName }).getByRole('spinbutton')` — pin 2 |
| `byRemoveButton` | **readonly arrow-function field** | `(productName: string) => this.cartRows.filter({ hasText: productName }).getByRole('button', { name: /remove/i })` — pin 11 |

> **Critical — qa-master conformance gate:** `byCartRowQtyInput` and `byRemoveButton` MUST be declared as `readonly` arrow-function fields, NOT class methods. The validator enforces: `readonly byCartRowQtyInput = (productName: string) => this.cartRows…`. Methods are reserved for actions; parameterised locators are declarative fields. See KB `qa-master/architecture/parameterised-locator-method`. Stage 2 that emits these as `byCartRowQtyInput(productName: string): Locator { … }` method syntax FAILS the conformance gate.

Action methods:

- `open(): Promise<void>` — `goto(URL_CART)`, then `waitForPageLoad()`
- `waitForPageLoad(): Promise<void>` — `expect(this.cartRows, '[Cart] Rows visible').toHaveCount(MOCK_CART_ITEM_COUNT)` — replaces `cy.wait('@getCart')` + `cy.wait(800)` sync points
- `updateItemQuantity(productName: string, qty: string): Promise<void>` — `byCartRowQtyInput(productName).fill(qty)`, click `buttonUpdateCart`, then `expect(this.byCartRowQtyInput(productName), '[Cart] Qty should persist after update').toHaveValue(qty)` — this web-first guard replaces `cy.wait(500)` and satisfies the Q13 post-update checklist item
- `clickCheckout(): Promise<void>` — `buttonCheckout.click()`
- `removeAllItems(productNames: string[]): Promise<void>` — for each `name` in `productNames`: `await this.byRemoveButton(name).click()`; after loop: `await expect(this.cartRows, '[Cart] All items removed').toHaveCount(0)`. The `byRemoveButton` arrow-function field re-evaluates the live DOM on each iteration — no stale reference risk. Addresses the `.each()` stale-snapshot smell.
- `expectCheckoutButtonDisabled(): Promise<void>` — `expect(this.buttonCheckout, '[Cart] Checkout button must be disabled on empty cart').toBeDisabled()` — semantic upgrade from CSS-class check
- `expectEmptyCartVisible(): Promise<void>` — `expect(this.textEmptyCartBanner, '[Cart] Empty cart banner visible').toBeVisible()`

Required `LABEL_CART` constant in `outputs/helper/test-data/labels.ts`.

---

**`outputs/helper/page-object/pages/checkout.page.ts`** — `PageClassCheckout extends BasePage`

No own constructor. Locator fields:

| Field | Type | Target locator |
|---|---|---|
| `inputCardNumber` | static | `getByLabel(/card number/i)` — pin 5 |
| `inputExpiry` | static | `getByLabel(/expiry date\|exp/i)` — pin 6 |
| `inputCvc` | static | `getByLabel(/cvc\|cvv/i)` — pin 7 |
| `buttonPayNow` | static | `getByRole('button', { name: /pay now/i })` — pin 8 |

`readonly url = URL_CHECKOUT` — sourced from `@test-data/urls` (not hardcoded as a string literal in the class body). No `open()` method because in this flow the checkout page is reached by clicking the Cart's "Checkout" button; navigation lives on `PageClassCart`. The `url` field exists for consistency and for future direct-navigation tests.

Action methods:

- `waitForPageLoad(): Promise<void>` — `expect(this.inputCardNumber, '[Checkout] Card number input visible').toBeVisible()` — card number input appearing signals the form is ready
- `fillPaymentDetails(card: { number: string; expiry: string; cvc: string }): Promise<void>` — `fill()` each input in sequence (no `.clear()` prefix — `fill()` replaces atomically)
- `clickPayNow(): Promise<void>` — `buttonPayNow.click()`

Required `LABEL_CHECKOUT` constant in `outputs/helper/test-data/labels.ts`.

---

**`outputs/helper/page-object/pages/order-confirmation.page.ts`** — `PageClassOrderConfirmation extends BasePage`

No own constructor. Locator fields:

| Field | Type | Target locator |
|---|---|---|
| `headingOrderConfirmed` | static | `getByRole('heading', { name: /order confirmed/i })` — pin 9 |
| `textSummaryTotal` | static | `getByTestId('summary-total')` — pin 10 |

`readonly url = URL_ORDER_CONFIRMED` — sourced from `@test-data/urls`.

Action methods:

- `waitForPageLoad(): Promise<void>` — `expect(this.headingOrderConfirmed, '[Order Confirmation] Heading visible').toBeVisible()`
- `expectUrl(): Promise<void>` — `expect(this.page).toHaveURL(/\/order-confirmed/)`
- `expectOrderConfirmedVisible(): Promise<void>` — `expect(this.headingOrderConfirmed, '[Order Confirmation] Confirmed heading').toBeVisible()`
- `expectSummaryContainsCurrency(): Promise<void>` — `expect(this.textSummaryTotal, '[Order Confirmation] Summary contains $').toContainText('$')`

Required `LABEL_ORDER_CONFIRMATION` constant in `outputs/helper/test-data/labels.ts`.

---

### Fixture: `outputs/helper/fixtures/base.fixture.ts` (mutate)

Add `cartPage`, `checkoutPage`, `orderConfirmationPage` as injected `PageClass*` fixtures following the existing `base.extend<Fixtures>({…})` pattern. This file remains the only one importing from `@playwright/test`.

### Fixture: `outputs/helper/fixtures/checkout-mocks.fixture.ts` (new)

Extends `base.fixture.ts`. Declares two `auto: true` route stubs:

- `GET **/api/cart` → `route.fulfill({ status: 200, json: MOCK_CART })` typed as `CartApiResponse` from `@type-defs/external/cart-api`
- `POST **/api/checkout/pay` → `route.fulfill({ status: 201, json: MOCK_PAYMENT })` typed as `PaymentApiResponse` from `@type-defs/external/payment-api`

**Must re-export `expect`:** `export { expect }` re-exported from `@fixtures/base.fixture`. The spec imports `{ test, expect }` from `@fixtures/checkout-mocks.fixture` — this satisfies the "single import source for both test and expect" invariant while scoping the mock routes to only the checkout spec. Stage 2 must NOT emit a spec that imports only `test` (without `expect`) or imports from a path other than `@fixtures/checkout-mocks.fixture`. This import pattern is the intentional deviation from the global "import from base.fixture" principle when a spec requires feature-specific auto-mocks; it is acceptable when the mocks fixture re-exports `expect`.

### Action: `outputs/helper/actions/complete-checkout.ts` (new)

Justification: the happy-path journey crosses three page objects (Cart → Checkout → OrderConfirmation).

Signature:
```
completeCheckout({
  cartPage, checkoutPage, orderConfirmationPage,
  productName, newQuantity, card
}: CompleteCheckoutParams): Promise<PageClassOrderConfirmation>
```

Steps in order:
1. `cartPage.updateItemQuantity(productName, newQuantity)`
2. `cartPage.clickCheckout()`
3. `checkoutPage.waitForPageLoad()`
4. `checkoutPage.fillPaymentDetails(card)`
5. `checkoutPage.clickPayNow()`
6. `orderConfirmationPage.waitForPageLoad()`
7. `return orderConfirmationPage`

`CompleteCheckoutParams` is an inline type in this file (no separate `helper/types/internal/` file needed for a single-use param shape).

### Test-data files

**`outputs/helper/test-data/checkout.ts`** (new): exports `MOCK_CART` (type `CartApiResponse`), `MOCK_PAYMENT` (type `PaymentApiResponse`), `TEST_CARD_NUMBER`, `TEST_CARD_EXPIRY`, `TEST_CARD_CVC`, `MOCK_CART_ITEM_COUNT` (number), `PRODUCT_NAMES` (string array of item names in MOCK_CART, used by `removeAllItems`). Payment values are extracted from the hardcoded strings on lines 32–34.

**`outputs/helper/test-data/labels.ts`** (mutate): add `LABEL_CART`, `LABEL_CHECKOUT`, `LABEL_ORDER_CONFIRMATION`.

**`outputs/helper/test-data/urls.ts`** (mutate): add `URL_CART = '/cart'`, `URL_CHECKOUT = '/checkout'`, `URL_ORDER_CONFIRMED = '/order-confirmed'`. All three URL constants are referenced from POM `url` fields — no hardcoded string literals in page objects.

### Type files

**`outputs/helper/types/external/cart-api.ts`** (new): `CartApiResponse` — typed shape for the GET `/api/cart` stub payload (items array with name, qty, price; cart total).

**`outputs/helper/types/external/payment-api.ts`** (new): `PaymentApiResponse` — typed shape for the POST `/api/checkout/pay` stub response (orderId, status).

> **Import alias note (KB-1.1.27):** Both type files must be imported via the `@type-defs/external/` alias, NOT `@types/external/`. The `@types/` prefix collides with npm's DefinitelyTyped scope and causes `TS6137` at compile time. Stage 2 must emit `import type { CartApiResponse } from '@type-defs/external/cart-api'` throughout — including in `checkout.ts` test-data and `checkout-mocks.fixture.ts`.

### Spec file

**`outputs/tests/checkout-flow.spec.ts`** (new):

```
import { test, expect } from '@fixtures/checkout-mocks.fixture';
import { completeCheckout } from '@actions/complete-checkout';
import { TEST_CARD_NUMBER, TEST_CARD_EXPIRY, TEST_CARD_CVC,
         PRODUCT_NAMES, MOCK_CART_ITEM_COUNT } from '@test-data/checkout';
```

One `test.describe('Beacon Shop — checkout', () => { … })` block (single level). `test.beforeEach` calls `cartPage.open()` only (≤3 lines). Two `test(…)` calls with `// plan:scenario=1.1` and `// plan:scenario=1.2` comments respectively.

### Summary table

| Layer | File path | Why |
|---|---|---|
| Page | `outputs/helper/page-object/pages/cart.page.ts` | Cart rows, qty input, checkout/remove/update actions |
| Page | `outputs/helper/page-object/pages/checkout.page.ts` | Payment form (card/exp/cvc/pay-now) |
| Page | `outputs/helper/page-object/pages/order-confirmation.page.ts` | Confirmed heading + summary-total |
| Block | (none) | No section exceeds 5 locators or appears on 3+ pages |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add cartPage, checkoutPage, orderConfirmationPage injections |
| Fixture | `outputs/helper/fixtures/checkout-mocks.fixture.ts` (new) | Auto-route /api/cart + /api/checkout/pay; re-exports expect |
| API | (none) | No data prep needed; cart pre-populated via mock |
| Action | `outputs/helper/actions/complete-checkout.ts` (new) | Cross-page flow: Cart → Checkout → OrderConfirmation |
| Utility | (none) | No numeric/date parsing required |
| Test-data | `outputs/helper/test-data/checkout.ts` (new) | MOCK_CART, MOCK_PAYMENT, TEST_CARD_*, PRODUCT_NAMES |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | LABEL_CART, LABEL_CHECKOUT, LABEL_ORDER_CONFIRMATION |
| Test-data | `outputs/helper/test-data/urls.ts` (mutate) | URL_CART, URL_CHECKOUT, URL_ORDER_CONFIRMED |
| Type | `outputs/helper/types/external/cart-api.ts` (new) | CartApiResponse shape for /api/cart stub |
| Type | `outputs/helper/types/external/payment-api.ts` (new) | PaymentApiResponse shape for /api/checkout/pay stub |
| Spec | `outputs/tests/checkout-flow.spec.ts` (new) | The migrated test |

---

## Open questions for reviewer

```
Q1: Do cart rows have a data-testid attribute?
Context: source uses `.cart-row` CSS class (line 24). Plan assumes data-testid="cart-row".
What I assumed: testid exists matching the class name pattern.
Impact if wrong: cartRows locator does not resolve; must fall back to locator('.cart-row') per pin 1.
```

```
Q2: What is the accessible role and label of the quantity input?
Context: source uses .find('.qty-input') scoped inside .cart-row (line 26).
         Plan assumes <input type="number"> (role=spinbutton) scoped via filter({ hasText: productName }).
What I assumed: qty input is type="number" with no associated label.
Impact if wrong: byCartRowQtyInput will not resolve;
         Stage 2 must use getByRole('textbox') or getByLabel if a label is present.
```

```
Q3: Is the "Update cart" element a <button>?
Context: cy.contains('Update cart').click() (line 27). Plan assumes getByRole('button', …).
What I assumed: it is a <button> element.
Impact if wrong: role-based locator times out; need getByText(/update cart/i) or getByRole('link').
```

```
Q4: Is the "Checkout" CTA a <button> or <a>?
Context: cy.contains('Checkout').click() (lines 30, 53). Plan assumes getByRole('button', …).
What I assumed: it is a <button>. Also: toBeDisabled() catches semantic disabled (HTML disabled attr
         or aria-disabled="true") but NOT purely visual CSS-only states.
Impact if wrong: incorrect role causes locator to not resolve; also expectCheckoutButtonDisabled()
         may always return false if element is <a> with no aria-disabled.
```

```
Q5: Is the payment form inside a third-party iframe (Stripe, Adyen, Braintree)?
Context: cy.get('input[name="card"]') (line 32). If inside an iframe, getByLabel will not resolve
         without frameLocator.
What I assumed: payment inputs are in the top-level document.
Impact if wrong: all three payment input locators (pins 5-7) fail silently;
         need frameLocator wrapping with correct iframe selector.
```

```
Q6: What accessible name does the "Pay now" button have?
Context: cy.get('button.pay-now').click() (line 35). Accessible name inferred from class .pay-now.
What I assumed: button text is /pay now/i.
Impact if wrong: locator times out; must update regex in buttonPayNow.
```

```
Q7: What is the exact URL slug for the order confirmation page?
Context: cy.url().should('include', '/order-confirmed') (line 42).
What I assumed: URL contains /order-confirmed (not /order-confirmation or /orders/confirm).
Impact if wrong: expectUrl() assertion fails; update URL_ORDER_CONFIRMED and regex.
```

```
Q8: Does the summary total element have a data-testid="summary-total"?
Context: cy.get('.summary-total') (line 44). Plan assumes testid exists.
What I assumed: testid matches class name.
Impact if wrong: fall back to locator('.summary-total') per pin 10.
```

```
Q9: What is the accessible name of the remove button on each cart row?
Context: cy.get('.cart-row .remove-btn').each(…) (line 48). Accessible name inferred from class.
What I assumed: accessible name matches /remove/i.
Impact if wrong: byRemoveButton locator does not resolve; update regex in arrow-function field.
```

```
Q10: What ARIA role does the empty-cart banner have?
Context: cy.get('.empty-cart-banner') (line 52). Plan assumes role="status".
What I assumed: role="status" (non-urgent informational).
Impact if wrong: getByRole('status') returns empty;
         fall back to getByRole('alert') or getByTestId('empty-cart-banner') per pin 12.
```

```
Q11: How many items are in the cart at test start, and what are their names?
Context: source asserts cy.get('.cart-row').should('have.length.gte', 2) (line 24).
         With page.route stubbing, MOCK_CART determines item count and names exactly.
What I assumed: MOCK_CART has 2 items; their names populate PRODUCT_NAMES constant.
Impact if wrong: waitForPageLoad() count assertion fails; removeAllItems() receives wrong names.
```

```
Q12: Should the non-user-perceivable backend assertions (statusCode, orderId) be dropped?
Context: cy.wait('@payReq').then(interception => { expect(statusCode === 201)… }) (lines 37-40).
         These assert on raw HTTP internals, not on what the user perceives.
What I assumed: YES — drop these. URL + "Order confirmed" heading are stronger oracles.
         If backend contract testing is needed, a dedicated API test is more appropriate.
Impact if wrong: if reviewer requires orderId validation, note that re-introducing
         cy.wait('@alias').then() style is forbidden; use a separate API-layer assertion instead.
```

```
Q13: What visible state confirms "Update cart" completed?
Context: source uses cy.wait(500) after cy.contains('Update cart').click() (lines 27-28).
What I assumed: the quantity input retains the new value — toHaveValue(qty) inside
         updateItemQuantity() is the web-first guard replacing the hard wait.
Impact if wrong: if the update triggers a full page reload that removes the qty input temporarily,
         the assertion will time out. Reviewer should confirm observable state after update click.
```

---

## Risk callouts

**1. Payment form iframe boundary (blocking if present):** If the real payment form is served from a Stripe/Adyen hosted-fields iframe, `getByLabel(/card number/i)` will not find the input without a `frameLocator`. With `page.route` stubbing `/api/checkout/pay`, the test may still encounter the iframe if the payment SDK mounts before the mock triggers. Mitigation: confirm whether checkout page renders a local form or embeds a third-party SDK iframe (Q5). If iframe, pins 5–7 must be revised to use `page.frameLocator(…).getByLabel(…)`.

**2. CSS-class disabled → semantic `toBeDisabled()` (intentional stricter assertion):** The source asserts `have.class 'is-disabled'` on the Checkout button's parent element. The migration asserts `toBeDisabled()` on the button itself — a deliberate stricter upgrade. This WILL FAIL if the button uses purely visual CSS-disabled state with no `disabled` HTML attribute or `aria-disabled="true"`. That failure is the correct behavior — it surfaces a real accessibility bug. Reviewer decision: if the app uses CSS-only disabled state, the FE team must add semantic disabled to the element before this assertion can pass.

**3. `removeAllItems` DOM re-render between clicks:** After each `byRemoveButton(name).click()`, the cart re-renders removing the row. The `byRemoveButton` lazy field re-evaluates the DOM on each iteration — correct Playwright behavior. However, if the cart re-render triggers a loading spinner that hides remaining rows, `byRemoveButton(nextName)` may time out. Mitigation: `page.route` mock returns instantly so no loading state should appear; if it does, add a `waitForLoadingGone()` guard between iterations.

**4. Dropped backend assertions (non-user-perceivable):** The source asserts `response.statusCode === 201` and `response.body.orderId.match(/^ord_/)` via `.then()`. The migration drops these — they check internal API contracts, not user-visible outcomes, and the `cy.wait('@req').then()` pattern (KB-1.2.11) is forbidden in target code. If the reviewer requires backend contract verification, a dedicated API-layer test is the correct venue.

**5. `waitForPageLoad()` uses exact item count from mock:** The migrated `waitForPageLoad()` asserts `expect(cartRows).toHaveCount(MOCK_CART_ITEM_COUNT)` — stricter than the source's `have.length.gte, 2`. This is intentional: with an owned stub, the exact count is known and deterministic. Reviewer should confirm `MOCK_CART_ITEM_COUNT` before merge.

---

## Expected metrics

- **Selector quality score (estimated post-migration):** 14/14 = 1.00 — all locator fields in the three PageClass POMs use `getByRole`, `getByLabel`, or `getByTestId`; zero CSS-class or index-based selectors emitted
- **Smell count delta:** −30 (−2 hard waits, −2 intercepts without stub, −6 CSS-class selectors, −3 attribute selectors, −5 `cy.contains` ambiguous, −3 hardcoded credentials, −2 `cy.wait(@alias)` no timeout, −1 index selector, −1 `clear().type()`, −1 `.each()` stale iteration, −1 URL over-spec, −1 `.then()` nested assertions, −1 CSS-class disabled check, −1 viewport magic numbers; +0 new smells)
- **LOC delta:** source 55 LOC → estimated output ~400 LOC across all emitted files → **delta ≈ +345**
- **Anti-pattern coverage:** 14/14 distinct anti-pattern categories addressed
