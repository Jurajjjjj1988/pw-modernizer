# Migration plan: checkout-flow.cy.js

## Source framework

**Cypress** — detected by:
- File extension `.cy.js`
- `cy.*` API calls throughout (`cy.get`, `cy.visit`, `cy.intercept`, `cy.wait`, `cy.contains`)
- `describe / it` test runner shape
- `/// <reference types="cypress" />` triple-slash directive

Source version: inferred Cypress 12/13 (modern `cy.intercept`, relative `cy.visit` paths, no deprecated `cy.server()`). No `package.json` present in the input directory.

Target: **Playwright TypeScript** (v1.45+), qa-master layered architecture (v0.2.0).

---

## Summary

This two-test suite covers the Beacon Shop checkout flow. Test 1 verifies that a user who updates a cart item's quantity and proceeds through the credit-card payment form reaches the order-confirmation page. Test 2 verifies that the Checkout CTA is disabled once every item has been removed from the cart. Together they catch a class of regression where either the payment submission silently fails to navigate the user forward, or the Checkout button remains interactive on an empty cart.

### What bug does this catch?

Catches a regression where submitting a valid credit-card payment does not redirect the user to the order-confirmation page, OR where the Checkout CTA is still clickable after the cart has been fully emptied.

### User-perceivable assertion checklist

**Scenario 1.1 — happy-path credit-card checkout:**
- [ ] After visiting `/cart`: at least 2 cart rows are visible
- [ ] After updating the second row's quantity to 3 and clicking "Update cart": cart reflects the update (see Q13 — no explicit assert in source; Stage 2 must add a post-update guard)
- [ ] After clicking "Checkout", filling payment form, and clicking "Pay Now": URL matches `/order-confirmed`
- [ ] After payment: an "Order confirmed" heading/text is visible on the confirmation page
- [ ] After payment: the summary total element contains a `$` currency symbol

**Scenario 1.2 — empty cart disables checkout:**
- [ ] After removing all items: the empty-cart banner is visible
- [ ] After removing all items: the Checkout CTA is in a disabled state (semantic `disabled` or `aria-disabled`, not only a CSS class — see unclassified smells)

> **Dropped assertion:** The source checks `interception.response.statusCode === 201` and `interception.response.body.orderId` matching `/^ord_/` via `cy.wait('@payReq').then(...)`. These are backend assertions (not user-perceivable). They are catalogued in the anti-pattern table and will be replaced by the URL + heading confirmation. See Q12 for whether the order ID appears on the confirmation page.

---

## Anti-patterns detected

Sorted by Severity descending (H → M → L), then by Line ascending.

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 20 | KB-1.2.1 | hard wait | `cy.wait(800)` | web-first assertion on cart content visible |
| H | 29 | KB-1.2.1 | hard wait | `cy.wait(500)` | web-first assertion on post-update cart state |
| H | 53 | KB-UNCLASSIFIED | CSS-class disability check | `parent().should('have.class', 'is-disabled')` | `await expect(checkoutBtn).toBeDisabled()` — see unclassified smells |
| M | 15 | KB-1.2.13 | viewport magic numbers in test | `cy.viewport(1366, 768)` | move to `playwright.config.ts` desktop project |
| M | 16 | KB-1.2.7 | intercept without explicit stub | `cy.intercept('GET', '/api/cart').as(…)` | `page.route('**/api/cart', route => route.fulfill({...}))` with typed response |
| M | 17 | KB-1.2.7 | intercept without explicit stub | `cy.intercept('POST', '/api/checkout/pay')…` | `page.route('**/api/checkout/pay', route => route.fulfill({...}))` |
| M | 19 | KB-1.2.36 | `cy.wait('@alias')` without explicit timeout | `cy.wait('@getCart')` | drop — `page.route` fulfills synchronously; or use `waitForResponse` with timeout |
| M | 24 | KB-1.2.3 | CSS-class primary selector | `cy.get('.cart-row')` | `getByTestId('cart-row')` or role-based (see Q4) |
| M | 27 | KB-1.2.2 | index-based selector | `cy.get('.cart-row').eq(1)` | scope by product name / testid filter (see Q4) |
| M | 27 | KB-1.2.3 | CSS-class selector (child) | `.find('.qty-input')` | `getByLabel(/quantity/i)` or `getByRole('spinbutton')` (see Q5) |
| M | 27 | KB-1.2.30 | `clear().type()` pattern | `.clear().type('3')` | `.fill('3')` — atomic replace |
| M | 28 | KB-1.2.6 | `cy.contains` ambiguous text match | `cy.contains('Update cart').click()` | `getByRole('button', { name: /update cart/i })` (see Q6) |
| M | 31 | KB-1.2.6 | `cy.contains` ambiguous text match | `cy.contains('Checkout').click()` | `getByRole('button', { name: /^checkout$/i })` (see Q7) |
| M | 33 | KB-1.2.3 | attribute selector (not role-based) | `cy.get('input[name="card"]')` | `getByLabel(/card number/i)` (see Q8) |
| M | 34 | KB-1.2.3 | attribute selector (not role-based) | `cy.get('input[name="exp"]')` | `getByLabel(/expiry date\|exp/i)` (see Q8) |
| M | 35 | KB-1.2.3 | attribute selector (not role-based) | `cy.get('input[name="cvc"]')` | `getByLabel(/cvc\|cvv\|security code/i)` (see Q8) |
| M | 33-35 | KB-1.1.9 | hardcoded payment credentials (magic strings) | `'4242 4242 4242 4242'`, `'12/30'`, `'123'` | extract to `TEST_CARD_*` constants in `helper/test-data/checkout.ts` |
| M | 36 | KB-1.2.3 | CSS-class composite selector for button | `cy.get('button.pay-now')` | `getByRole('button', { name: /pay now/i })` (see Q8) |
| M | 37-40 | KB-1.2.11 | `cy.wait('@req').then()` chain with buried assertions | `cy.wait('@payReq').then((ic) => {…})` | `page.waitForResponse()` + flat assertions OR drop (see Q12) |
| M | 44 | KB-1.2.3 | CSS-class selector | `cy.get('.summary-total')` | `getByTestId('summary-total')` or role-based (see Q9) |
| M | 48-50 | KB-1.2.3 | CSS descendant-class selector | `cy.get('.cart-row .remove-btn').each(…)` | `getByRole('button', { name: /remove/i })` (see Q11) |
| M | 48-50 | KB-1.2.18 | snapshot iteration via `.each()` | `.each(($btn) => { cy.wrap($btn).click() })` | iterate a live Locator; assert count first |
| M | 52 | KB-1.2.3 | CSS-class selector | `cy.get('.empty-cart-banner')` | `getByRole('status')` or `getByTestId(…)` (see Q10) |
| M | 53 | KB-1.2.6 | `cy.contains` ambiguous text match | `cy.contains('Checkout').parent()` | target the Checkout CTA directly for disability check |
| L | 37 | KB-1.2.36 | `cy.wait('@alias')` without explicit timeout | `cy.wait('@payReq')` | subsumed by KB-1.2.11 fix above |
| L | 42 | KB-1.2.32 | URL check not web-first | `cy.url().should('include', '/order-confirmed')` | `await expect(page).toHaveURL(/\/order-confirmed/)` |
| L | 37-40 | KB-UNCLASSIFIED | non-user-perceivable API body assertion | `expect(ic.response.body.orderId).to.match(…)` | drop; replace with visible URL + heading (see Q12) |

### Unclassified smells

**CSS-class disability assertion (line 53):** `cy.contains('Checkout').parent().should('have.class', 'is-disabled')` asserts on a CSS class rather than on semantic disabled state. This passes even if the button is visually styled as disabled but remains fully interactive. The Playwright equivalent is `await expect(checkoutButton).toBeDisabled()` (checks HTML `disabled` attribute) or `toHaveAttribute('aria-disabled', 'true')` if ARIA is used instead. No KB ID catalogues this specific pattern. Reviewer must confirm whether the Checkout CTA uses `disabled`, `aria-disabled`, or purely CSS-class disabling — the choice determines which assertion Stage 2 emits. See Q7.

**Non-user-perceivable API body assertion (lines 37-40):** `expect(interception.response.body.orderId).to.match(/^ord_/)` asserts on a JSON field the user never sees. No KB ID. The migration replaces this with the user-visible URL change and "Order confirmed" heading. If the order ID is displayed on the confirmation page, it becomes a user-visible assertion Stage 2 must add. See Q12.

---

## Locator translation table

No DOM snapshot present at `outputs/dom-snapshots/checkout-flow.cy.js.yaml` — all confidence levels are inferred from source context, variable names, and locator strategy conventions.

| Original | New | Confidence | Notes |
|---|---|---|---|
| `cy.get('.cart-row')` | `page.getByTestId('cart-row')` | low | CSS class only; no role or ARIA evidence. Requires `data-testid="cart-row"` on each row or reviewer DOM confirmation. See Q4. |
| `cy.get('.cart-row').eq(1).find('.qty-input')` | `cartPage.byCartRowQtyInput(productName)` → scoped `getByRole('spinbutton')` | low | Index `eq(1)` must be replaced by a product-name or testid filter. `spinbutton` role assumed for `type="number"` input. See Q4, Q5. |
| `cy.contains('Update cart')` | `page.getByRole('button', { name: /update cart/i })` | med | `cy.contains` text match; assuming `<button>` — could be `<a>`. See Q6. |
| `cy.contains('Checkout')` (line 31) | `page.getByRole('button', { name: /^checkout$/i })` | med | Anchored regex avoids matching "Checkout" in headings or breadcrumbs. Could be `<a>`. See Q7. |
| `cy.get('input[name="card"]')` | `page.getByLabel(/card number/i)` | low | `name="card"` does not reveal the visible label text. If Stripe/Adyen iframe: needs `frameLocator(...)`. See Q8. |
| `cy.get('input[name="exp"]')` | `page.getByLabel(/expiry date\|exp/i)` | low | `name="exp"` is abbreviated; visible label text unknown. See Q8. |
| `cy.get('input[name="cvc"]')` | `page.getByLabel(/cvc\|cvv\|security code/i)` | med | CVC/CVV is standard payment terminology; reasonable label assumption. See Q8. |
| `cy.get('button.pay-now')` | `page.getByRole('button', { name: /pay now/i })` | med | CSS class `.pay-now` implies accessible name "Pay now"; `button` tag confirms role. See Q8. |
| `cy.get('.summary-total')` | `page.getByTestId('summary-total')` | low | CSS class only; no role evidence. Requires FE `data-testid` or reviewer DOM confirmation. See Q9. |
| `cy.contains('Order confirmed')` | `page.getByRole('heading', { name: /order confirmed/i })` | med | Success-page text assumed to be a heading (`<h1>`/`<h2>`). Could be `<p>` or `<div>`. See open question below pin 10. |
| `cy.get('.cart-row .remove-btn').each(…)` | `page.getByRole('button', { name: /remove/i })` | low | CSS class `.remove-btn`; accessible name unknown. May be icon-only with no text. See Q11. |
| `cy.get('.empty-cart-banner')` | `page.getByRole('status')` | low | CSS class only. Could be `role="alert"`, `role="status"`, or no semantic role. See Q10. |
| `cy.contains('Checkout').parent()` (line 53) | `page.getByRole('button', { name: /^checkout$/i })` | med | Assert disabled state directly on the button rather than on a CSS class on its parent. See Q7. |

---

## Hallucination-defense pins

One pin per MED/LOW locator, ordered as they appear in the translation table above.

1. **Cart rows collection** — assumed `page.getByTestId('cart-row')`. If DOM has no `data-testid="cart-row"`: keep `page.locator('.cart-row')`, add WHY-comment `'Q4 unresolved: cart-row testid absent, CSS fallback'`. Reviewer fallback: ask FE team to add `data-testid="cart-row"` to each row element, OR confirm the row's semantic role (e.g. `role="row"` in a `<table>` layout).

2. **Quantity input for the second cart row** — assumed `cartPage.byCartRowQtyInput(productName)` resolving to a product-name-scoped `getByRole('spinbutton')`. If no spinbutton role or no stable product-name filter: keep `page.locator('.cart-row').nth(1).locator('.qty-input')`, add WHY-comment `'Q5 unresolved: qty input label unknown, fragile nth fallback'`. Reviewer fallback: confirm quantity input is `type="number"` and supply the second row's product name.

3. **"Update cart" button** — assumed `page.getByRole('button', { name: /update cart/i })`. If element is `<a>`: use `getByRole('link', { name: /update cart/i })`, add WHY-comment `'Q6 unresolved: Update cart element role not confirmed'`. Reviewer fallback: inspect HTML; if neither `<button>` nor `<a>`, fall back to `getByText(/update cart/i)`.

4. **Checkout CTA (click and disabled assertion)** — assumed `page.getByRole('button', { name: /^checkout$/i })` with `toBeDisabled()`. If element is `<a aria-disabled="true">`: switch to `getByRole('link', ...)` and assert `toHaveAttribute('aria-disabled', 'true')`, add WHY-comment `'Q7 unresolved: Checkout CTA role and disabled mechanism not confirmed'`. Reviewer fallback: inspect DOM for `<button disabled>` vs. `<a aria-disabled="true">` vs. CSS-only.

5. **Card number input** — assumed `page.getByLabel(/card number/i)`. If payment form is inside a Stripe/Adyen/Braintree iframe: replace with `page.frameLocator('iframe[title*="card" i]').getByRole('textbox', { name: /card number/i })`, add WHY-comment `'Q8 unresolved: card input iframe nesting unknown'`. Reviewer fallback: inspect payment form HTML for any `<iframe>` wrappers and supply the iframe selector.

6. **Expiry date input** — assumed `page.getByLabel(/expiry date|exp/i)`. Same iframe caveat as pin 5. If label text differs: keep `page.locator('input[name="exp"]')`, add WHY-comment `'Q8 unresolved: expiry input label text unknown'`. Reviewer fallback: confirm visible label text.

7. **Summary total display** — assumed `page.getByTestId('summary-total')`. If no testid: keep `page.locator('.summary-total')`, add WHY-comment `'Q9 unresolved: summary-total testid absent, CSS fallback'`. Reviewer fallback: ask FE to add `data-testid="summary-total"`, or confirm role (e.g. `role="cell"` in a totals table).

8. **"Order confirmed" element** — assumed `page.getByRole('heading', { name: /order confirmed/i })`. If element is not a heading: use `page.getByText(/order confirmed/i)`, add WHY-comment `'Q10b unresolved: order-confirmed element role assumed heading'`. Reviewer fallback: confirm the element is `<h1>`–`<h6>`.

9. **Remove item button** — assumed `page.getByRole('button', { name: /remove/i })`. If button is icon-only (no accessible name): keep `page.locator('.remove-btn')`, add WHY-comment `'Q11 unresolved: remove button accessible name unknown'`. Reviewer fallback: request FE adds `aria-label="Remove"` to icon buttons, or supply a testid.

10. **Empty-cart banner** — assumed `page.getByRole('status')`. If element has no ARIA role: keep `page.locator('.empty-cart-banner')`, add WHY-comment `'Q10 unresolved: empty-cart-banner ARIA role not confirmed'`. Reviewer fallback: confirm `role="status"` or `role="alert"`, or request `data-testid="empty-cart-banner"`.

---

## Structural changes

The source test is a **Cypress → Playwright TypeScript** translation (non-subtractive). The checkout journey crosses three pages (Cart → Checkout → Order Confirmation), so the qa-master Action layer is justified per `migration-rules.md` §5e.

### 5a — Pages

**`outputs/helper/page-object/pages/cart.page.ts`** — `PageClassCart extends BasePage`
- `readonly url = '/cart'`
- Static locators: `arrayCartRows`, `buttonUpdateCart`, `buttonCheckout`, `textEmptyCartBanner`
- Parameterised: `byCartRowQtyInput(productNameFilter: string)` — quantity input scoped to a named cart row
- Parameterised: `byRemoveButton(productNameFilter: string)` — remove button for a named row (falls back to `nth()` if no accessible name confirmed — see Q11)
- Methods: `open()`, `waitForPageLoad()`, `updateItemQuantity(productNameFilter: string, qty: string): Promise<void>`, `removeAllItems(count: number): Promise<void>`, `clickCheckout(): Promise<void>`
- Required `LABEL_CART` constant in `outputs/helper/test-data/labels.ts`

**`outputs/helper/page-object/pages/checkout.page.ts`** — `PageClassCheckout extends BasePage`
- `readonly url = '/checkout'` (assumed navigation URL — see Q7)
- Static locators: `inputCard`, `inputExp`, `inputCvc`, `buttonPayNow`, `headingCheckout`
- Methods: `waitForPageLoad()`, `fillPaymentCard(card: CheckoutCardData): Promise<void>`, `submitPayment(): Promise<void>`
- **If Q8 confirms payment fields are in an iframe:** add `readonly framePayment = this.page.frameLocator('...')` with sub-locators scoped inside it
- Required `LABEL_CHECKOUT` constant in `outputs/helper/test-data/labels.ts`

**`outputs/helper/page-object/pages/order-confirmation.page.ts`** — `PageClassOrderConfirmation extends BasePage`
- `readonly url = '/order-confirmed'`
- Static locators: `headingOrderConfirmed`, `textSummaryTotal`
- Methods: `waitForPageLoad()`
- Required `LABEL_ORDER` constant in `outputs/helper/test-data/labels.ts`

### 5b — Blocks

None. The payment form has 3 inputs + 1 button (4 locators), below the ~5 locator / 3 method extraction threshold. The cart page's locators are numerous but the section is not shared across multiple pages.

### 5c — Fixtures

**`outputs/helper/fixtures/base.fixture.ts`** (mutate) — add injectable POMs:
- `cartPage: PageClassCart`
- `checkoutPage: PageClassCheckout`
- `orderConfirmationPage: PageClassOrderConfirmation`

**`outputs/helper/fixtures/checkout-mocks.fixture.ts`** (create) — network stubs, `auto: true`:
- Stubs `**/api/cart` GET with a typed `CartApiResponse` mock containing exactly 2 items
- Stubs `**/api/checkout/pay` POST with `PaymentApiResponse` `{ orderId: 'ord_test_001', status: 'confirmed' }` at status 201
- Active for all tests in the spec that import from this fixture; eliminates real-backend dependency

### 5d — API wrappers

None. Network mocks via `page.route()` replace real-backend calls. No data-prep API wrapper is needed because the cart state is injected via the mock fixture.

### 5e — Actions

**`outputs/helper/actions/complete-checkout.ts`** (create)
- Extracted because the happy-path journey composes CartPage → CheckoutPage → OrderConfirmationPage (3 pages), meeting the §5e threshold
- Signature: `completeCheckout(params: { cartPage: PageClassCart; checkoutPage: PageClassCheckout; orderPage: PageClassOrderConfirmation; card: CheckoutCardData }): Promise<void>`
- Steps: `cartPage.clickCheckout()` → `checkoutPage.waitForPageLoad()` → `checkoutPage.fillPaymentCard(card)` → `checkoutPage.submitPayment()` → `orderPage.waitForPageLoad()`

### 5f — Utilities

None. No DOM string parsing is required (the `$` symbol check is a simple `toContainText`).

### 5g — Test data

**`outputs/helper/test-data/labels.ts`** (mutate) — add:
- `export const LABEL_CART = 'Cart'`
- `export const LABEL_CHECKOUT = 'Checkout'`
- `export const LABEL_ORDER = 'Order Confirmation'`

**`outputs/helper/test-data/checkout.ts`** (create) — payment constants:
- `export const TEST_CARD_NUMBER = '4242 4242 4242 4242'`
- `export const TEST_CARD_EXPIRY = '12/30'`
- `export const TEST_CARD_CVC = '123'`
- `export type CheckoutCardData = { number: string; expiry: string; cvc: string }`
- `export const TEST_CARD: CheckoutCardData = { number: TEST_CARD_NUMBER, expiry: TEST_CARD_EXPIRY, cvc: TEST_CARD_CVC }`

**`outputs/helper/test-data/urls.ts`** (mutate) — add:
- `export const URL_CART = '/cart'`
- `export const URL_ORDER_CONFIRMED = '/order-confirmed'`

### 5h — Types

**`outputs/helper/types/external/cart-api.ts`** (create) — shape for `/api/cart` GET mock:
- `export type CartItem = { id: string; name: string; quantity: number; unitPrice: string }`
- `export type CartApiResponse = { items: CartItem[] }`
- Reviewer must confirm actual field names (see Q1)

**`outputs/helper/types/external/payment-api.ts`** (create) — shape for `/api/checkout/pay` 201 response:
- `export type PaymentApiResponse = { orderId: string; status: string }`
- Reviewer must confirm actual field names (see Q2)

### 5i — Spec file

**`outputs/tests/checkout-flow.spec.ts`** — no split; both scenarios cover the same checkout feature.
- `import { test, expect } from "@fixtures/base.fixture"`
- `test.describe('Checkout flow', () => { ... })`
- Scenario 1.1 title: `[CHK-1] - Check that a credit-card payment completes the order` tagged `@positive @e2e`
- Scenario 1.2 title: `[CHK-2] - Check that the checkout CTA is disabled on an empty cart` tagged `@negative`

### File summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/cart.page.ts` | Cart row locators, qty input, remove buttons, update/checkout CTAs, empty-cart banner |
| Page | `outputs/helper/page-object/pages/checkout.page.ts` | Payment form (card/exp/cvc inputs) + pay-now button |
| Page | `outputs/helper/page-object/pages/order-confirmation.page.ts` | Order confirmed heading + summary total display |
| Block | (none) | Payment form is 4 locators — below the ~5 locator extraction threshold |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add `cartPage`, `checkoutPage`, `orderConfirmationPage` injection |
| Fixture | `outputs/helper/fixtures/checkout-mocks.fixture.ts` (create) | Auto-stubs `/api/cart` + `/api/checkout/pay`; eliminates real-backend coupling |
| API | (none) | Route mocks handle data injection; no backend data-prep wrapper needed |
| Action | `outputs/helper/actions/complete-checkout.ts` (create) | Journey crosses CartPage → CheckoutPage → OrderConfirmationPage (3 pages) |
| Utility | (none) | No DOM string parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | `LABEL_CART`, `LABEL_CHECKOUT`, `LABEL_ORDER` |
| Test-data | `outputs/helper/test-data/checkout.ts` (create) | `TEST_CARD_*` constants + `CheckoutCardData` type |
| Test-data | `outputs/helper/test-data/urls.ts` (mutate) | `URL_CART`, `URL_ORDER_CONFIRMED` |
| Type | `outputs/helper/types/external/cart-api.ts` (create) | `CartApiResponse` + `CartItem` shapes for `/api/cart` mock |
| Type | `outputs/helper/types/external/payment-api.ts` (create) | `PaymentApiResponse` shape for `/api/checkout/pay` mock |
| Spec | `outputs/tests/checkout-flow.spec.ts` (create) | The migrated test file |

---

## Open questions for reviewer

**Q1: Cart API mock response shape**
Context: lines 16, 19 — `cy.intercept('GET', '/api/cart').as('getCart')` — source spies without a stub body.
What I assumed (proceeding): `{ items: [{ id: string, name: string, quantity: number, unitPrice: string }] }`.
Impact if wrong: the mock may fail to parse on the app side; the cart page renders incorrectly and all assertions fail.

**Q2: Payment API response shape**
Context: lines 17, 37-40 — source checks `interception.response.body.orderId`.
What I assumed: `{ orderId: 'ord_test_001', status: 'confirmed' }`.
Impact if wrong: if the SUT looks for a field like `redirectUrl` in the 201 body to drive the navigation to `/order-confirmed`, the mock will keep the user on the checkout page and all confirmation-page assertions will time out.

**Q3: Authentication — is `/cart` a protected route?**
Context: line 18 — `cy.visit('/cart')` with no preceding login step anywhere in the file.
What I assumed: the cart route is accessible without authentication (guest checkout or pre-authenticated test environment).
Impact if wrong: every test gets redirected to `/login` instead of `/cart`, and all assertions fail with an unhelpful "element not found" error rather than an auth error.

**Q4: Cart row identity — what distinguishes row 2 from row 1?**
Context: line 27 — `cy.get('.cart-row').eq(1).find('.qty-input')` — index-based with no stable anchor.
What I assumed: `data-testid="cart-row"` can be added, and the second row corresponds to a known product name usable as a `filter({ hasText: ... })`.
Impact if wrong: Stage 2 emits `locator('.cart-row').nth(1)` as a fragile fallback with a `// TODO: fragile selector` comment; breaks the moment DOM order changes.

**Q5: Quantity input — label text and input type**
Context: line 27 — `.find('.qty-input')`.
What I assumed: `type="number"` (giving `role="spinbutton"`) with a visible label matching `/quantity|qty/i`.
Impact if wrong: `getByRole('spinbutton')` matches nothing; Stage 2 falls back to `locator('.qty-input')`.

**Q6: "Update cart" — is it a `<button>` or `<a>`?**
Context: line 28 — `cy.contains('Update cart').click()`.
What I assumed: `<button>` element.
Impact if wrong: `getByRole('button', { name: /update cart/i })` matches nothing; must switch to `getByRole('link', ...)`.

**Q7: Checkout CTA — element role AND disabled mechanism**
Context: lines 31, 53 — clicked in test 1; parent checked for `.is-disabled` CSS class in test 2.
What I assumed: `<button>` with HTML `disabled` attribute, so `toBeDisabled()` is the correct assertion.
Impact if wrong: if the element is `<a aria-disabled="true">`, `toBeDisabled()` never passes (it only checks HTML `disabled`). If disabling is purely CSS, `toBeDisabled()` always fails on a legitimately empty cart, incorrectly flagging a broken test.

**Q8: Payment form — visible label texts AND iframe structure**
Context: lines 33-36 — `input[name="card"]`, `input[name="exp"]`, `input[name="cvc"]`, `button.pay-now`.
What I assumed: all inputs are in the top-level DOM (not inside a payment-provider iframe) with labels matching `/card number/i`, `/expiry/i`, `/cvc|cvv/i`.
Impact if wrong: if the form is inside a Stripe/Adyen/Braintree iframe, ALL `page.getByLabel(...)` calls silently miss and the test times out. This is the highest-risk assumption in the plan — resolve before Stage 2.

**Q9: Summary total — role and testid**
Context: line 44 — `cy.get('.summary-total').should('contain', '$')`.
What I assumed: `data-testid="summary-total"` can be added, or the element has a discoverable role (e.g. `role="cell"` in a totals table).
Impact if wrong: Stage 2 falls back to `locator('.summary-total')` — same CSS fragility as the source.

**Q10: Empty-cart banner — ARIA role**
Context: line 52 — `cy.get('.empty-cart-banner').should('be.visible')`.
What I assumed: the banner has `role="status"` (informative, not urgent).
Impact if wrong: `getByRole('status')` matches nothing if it's a plain `<div>`; Stage 2 falls back to `locator('.empty-cart-banner')`.

**Q11: Remove button — accessible name**
Context: lines 48-50 — `.cart-row .remove-btn`.
What I assumed: each remove button has visible text or `aria-label` matching `/remove/i`.
Impact if wrong: `getByRole('button', { name: /remove/i })` returns an empty locator and `.click()` times out. FE must add `aria-label="Remove"` or a testid.

**Q12: Should the `orderId` assertion be preserved?**
Context: lines 37-40 — `expect(interception.response.body.orderId).to.match(/^ord_/)`.
What I assumed: drop the backend assertion; confirm completion by URL change + "Order confirmed" heading only.
Impact if wrong: if the orderId format regression is meaningful and the order ID is displayed on the confirmation page (e.g. "Your order #ord_xxx"), Stage 2 should add a locator + assertion for it; otherwise the migration creates a blind spot for orderId format regressions.

**Q13: Post-update-cart assertion gap**
Context: lines 27-29 — qty update, then `cy.wait(500)`, then proceed with no intermediate assertion.
What I assumed: Stage 2 should add a web-first guard after `updateItemQuantity()` — either `toHaveValue('3')` on the qty input or `toContainText('3')` on a cart-total element — to confirm the async update completed before navigating to checkout.
Impact if wrong: the migrated test may click "Checkout" before the update commits; the test intermittently submits the wrong quantity.

---

## Risk callouts

- **Payment iframe (HIGH):** If card inputs are inside a Stripe/Adyen iframe, all `page.getByLabel(...)` calls silently miss and the test times out with no descriptive error. Must confirm Q8 before Stage 2 generates payment form code.

- **Real backend dependency if mocks are omitted:** The source spies on `/api/cart` and `/api/checkout/pay` without stubs — it relies on a real backend with pre-populated cart data. The mock fixture eliminates that coupling. If a reviewer intentionally removes the mocks, the test reverts to hitting a live backend and becomes susceptible to backend state drift.

- **`cy.wait(800)` / `cy.wait(500)` masked real async latency:** Removing hard waits exposes the underlying async operations. If the migrated test times out on the post-update assertion or the cart-load assertion, it is surfacing a real backend latency — not a test bug.

- **CSS disability check is an intentionally stricter assertion:** `should('have.class', 'is-disabled')` passes even if the button is still clickable. The migration's `toBeDisabled()` is stricter; if it fails, the FE team must add the `disabled` attribute to the Checkout button on empty cart. This is an intentional quality improvement, not a test regression.

- **`.each()` iteration on unknown cart size:** Test 2 clicks every `.remove-btn` found on the page. The migrated version uses the mock-provided count (2 items); `removeAllItems(2)` must match the mock. If the mock item count changes, the test and the mock must be updated together.

- **`toHaveCount(≥2)` — Playwright has no direct `gte` assertion:** The source asserts `.should('have.length.gte', 2)`. Playwright's `toHaveCount(N)` requires an exact value. Stage 2 should assert `toHaveCount(2)` matching the fixed mock, or assert `toBeVisible()` on each of the two row locators explicitly.

- **`cy.wait('@getCart')` sync point disappears with full stub:** With `page.route(...)` fulfilling synchronously, the explicit response wait is no longer needed. If the test is ever run against a real backend, add `await page.waitForResponse('**/api/cart')` after `goto`.

---

## Expected metrics

- **Selector quality score (estimated post-migration):** 0.58 — 7/13 distinct locator targets are role/label-based at MED+ confidence; the remaining 6 depend on reviewer DOM confirmation. Score rises toward 1.0 once Q4–Q11 are resolved.
- **Smell count delta:** −26 (all 26 catalogued anti-pattern instances removed; 0 new smells introduced)
- **LOC delta:** +345 (source: 55 LOC → target outputs: ~400 LOC across spec + 3 pages + 1 action + 1 mock fixture + 3 test-data files + 2 type files)
- **Anti-pattern coverage:** 26/26
