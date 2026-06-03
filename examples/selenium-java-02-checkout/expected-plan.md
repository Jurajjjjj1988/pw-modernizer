# Migration plan: input.spec.ts (Selenium Java -> Playwright TypeScript)

## Source framework
selenium-java

## Summary
Three-step checkout flow on Acme Shop: shipping details, payment, review.
The user fills shipping, advances, fills card details (test card
`4242 4242 4242 4242`), advances to review, confirms the order total is a
currency value, places the order, and sees a personalised confirmation
heading.

## Anti-patterns detected

Sorted by Severity (H, M, L), then by Line.

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 43 | KB-1.3.1 | hard-wait | `Thread.sleep(1500)` | web-first wait on next step's first element |
| H | 44-45 | KB-1.3.15 | expected-conditions-verbose | `EC.visibilityOf(checkoutPage.cardNumberInput)` | `await expect(locator).toBeVisible()` |
| H | 51 | KB-1.3.1 | hard-wait | `Thread.sleep(1500)` | web-first; drop |
| H | 60 | KB-1.3.1 | hard-wait | `Thread.sleep(2000)` | web-first; drop |
| H | 65-74 | KB-1.3.14 | pagefactory-findby | `@FindBy(id = "shipping-name") public WebElement ...` | Playwright POM: `readonly shippingName = page.getByLabel('Full name')` |
| H | 30 | KB-1.3.14 | pagefactory-init-elements | `PageFactory.initElements(driver, CheckoutPage.class)` | drop; locators are lazy |
| H | 56 | KB-1.3.2 | xpath-deep | `//section[3]/div/div[2]/span[2]` | role/label-based locator (open question) |
| H | 75-76 | KB-1.3.3 | css-class-selector | `button.next-step`, `button.place-order` | `getByRole('button', { name: 'Next' })` |
| M | 42 | KB-1.3.6 | actions-builder-single-click | `new Actions(driver).click(...).perform()` | `locator.click()` |
| M | 57 | KB-1.3.10 | non-web-first-assertion | `assertTrue(orderTotal.getText().startsWith("$"))` | `await expect(loc).toHaveText(/^\$\d+/)` |
| M | 63 | KB-1.3.10 | non-web-first-assertion | `assertEquals("Thank you, Jane!", confirmation.getText())` | `await expect(loc).toHaveText('Thank you, Jane!')` |
| M | 26-31 | KB-1.3.12 | driver-setup-boilerplate | `@BeforeEach setUp() { new ChromeDriver(); ... }` | drop; `page` fixture |
| M | 33-36 | KB-1.3.12 | manual-driver-quit | `@AfterEach tearDown() { driver.quit(); }` | drop; `page` fixture |
| L | 38 | KB-1.3.1 | throws-InterruptedException | `throws InterruptedException` | drop with `Thread.sleep` |

## Locator translation table
| Original | New | Confidence | Notes |
|---|---|---|---|
| `@FindBy(id = "shipping-name")` | `page.getByLabel('Full name')` | medium | Assumes the input has an associated `<label>`. If it is placeholder-only, switch to `getByPlaceholder('Full name')`. |
| `@FindBy(id = "shipping-address")` | `page.getByLabel('Street address')` | medium | Same assumption. |
| `@FindBy(id = "shipping-city")` | `page.getByLabel('City')` | medium | Same. |
| `@FindBy(id = "shipping-zip")` | `page.getByLabel('ZIP / postcode')` | medium | Same. UK address terminology — confirm against the live form. |
| `@FindBy(id = "card-number")` | `page.getByLabel('Card number')` | medium | Same. |
| `@FindBy(id = "card-expiry")` | `page.getByLabel('Expiry')` | medium | Same. |
| `@FindBy(id = "card-cvc")` | `page.getByLabel('CVC')` | medium | Same. |
| `@FindBy(css = "button.next-step")` | `page.getByRole('button', { name: 'Next' })` | high | Step-advancing button. |
| `@FindBy(css = "button.place-order")` | `page.getByRole('button', { name: 'Place order' })` | high | Final submit button. |
| `By.xpath("//section[3]/div/div[2]/span[2]")` | `page.getByRole('definition', { name: 'Order total' })` | low | Reviewer's call — the original XPath is opaque. Best guess: the order total is a `<dd>` paired with `<dt>Order total</dt>` (definition role). If it is just a styled span, use `getByTestId('order-total')`. |
| `By.cssSelector(".order-confirmation h1")` | `page.getByRole('heading', { level: 1 })` | medium | Assumes there is a single H1 on the confirmation page. If there are multiple, narrow with `name`. |

## Hallucination-defense pins

1. **Shipping name input** — assumed `page.getByLabel('Full name')`. If the input is placeholder-only (no `<label>`): keep `@FindBy(id = "shipping-name")` → `page.locator('#shipping-name')`, add WHY-comment `'Q-labels unresolved: shipping-name label association'`. Reviewer fallback: ask FE team to add `<label for="shipping-name">Full name</label>` OR switch to `page.getByPlaceholder('Full name')`.
2. **Shipping address input** — assumed `page.getByLabel('Street address')`. If placeholder-only: keep `page.locator('#shipping-address')`, add WHY-comment `'Q-labels unresolved: shipping-address label'`. Reviewer fallback: confirm label copy ("Address" vs "Street address") OR use `page.getByPlaceholder('Street address')`.
3. **Shipping city input** — assumed `page.getByLabel('City')`. If placeholder-only: keep `page.locator('#shipping-city')`, add WHY-comment `'Q-labels unresolved: shipping-city label'`. Reviewer fallback: `page.getByPlaceholder('City')`.
4. **Shipping ZIP input** — assumed `page.getByLabel('ZIP / postcode')`. UK terminology is unverified and label association is assumed: keep `page.locator('#shipping-zip')`, add WHY-comment `'Q-labels unresolved: ZIP vs postcode copy'`. Reviewer fallback: confirm the exact label copy in DOM OR use `page.getByPlaceholder(...)`.
5. **Card number input** — assumed `page.getByLabel('Card number')`. If placeholder-only: keep `page.locator('#card-number')`, add WHY-comment `'Q-labels unresolved: card-number label'`. Reviewer fallback: `page.getByPlaceholder('Card number')`.
6. **Card expiry input** — assumed `page.getByLabel('Expiry')`. If placeholder-only: keep `page.locator('#card-expiry')`, add WHY-comment `'Q-labels unresolved: card-expiry label'`. Reviewer fallback: confirm copy ("Expiry" vs "Expiration date") OR use `page.getByPlaceholder(...)`.
7. **Card CVC input** — assumed `page.getByLabel('CVC')`. If placeholder-only: keep `page.locator('#card-cvc')`, add WHY-comment `'Q-labels unresolved: card-cvc label'`. Reviewer fallback: confirm copy ("CVC" vs "CVV" vs "Security code").
8. **Order total** — assumed `page.getByRole('definition', { name: 'Order total' })` (dt/dd pair). If the markup is just a styled `<span>`: keep `By.xpath("//section[3]/div/div[2]/span[2]")` (degraded), add WHY-comment `'Q-order-total unresolved: markup shape'`. Reviewer fallback: ask FE team to add `data-testid="order-total"` rather than locking the test to brittle positional XPath.
9. **Confirmation H1** — assumed single H1 on the confirmation page via `page.getByRole('heading', { level: 1 })`. If there are layout-level headings (multiple H1s): keep `By.cssSelector(".order-confirmation h1")` → `page.locator('.order-confirmation h1')`, add WHY-comment `'Q-confirmation-h1 unresolved: multiple H1 risk'`. Reviewer fallback: narrow with `{ name: /thank you/i }` OR scope under `page.getByTestId('order-confirmation')`.

## Structural changes
- Extract POM: YES — checkout has 9 distinct locators across 3 steps;
  inlining them in a single test would obscure the user flow. A small
  POM with lazy getters captures the shape without the PageFactory
  eagerness.
- Extract fixture: no — single test; `page` fixture is enough.
- Split into multiple specs: no — single end-to-end happy path. (If we
  add per-step validation tests later, split then.)

## Open questions for reviewer
- **Q-labels**: Do all 7 form fields (shipping name/address/city/ZIP, card number/expiry/CVC) have associated `<label>` elements? Plan assumes `getByLabel(...)` for each; without labels, switch to `getByPlaceholder(...)` or `data-testid`.
- **Q-order-total**: Is the order-total markup a definition list (`<dt>`/`<dd>`), a styled `<span>`, or testid-marked? Determines whether `getByRole('definition', { name: 'Order total' })` works or we keep brittle positional XPath.
- **Q-confirmation-h1**: Is the confirmation page H1 the only H1 on the page? If the page has layout-level headings, narrow the locator with a name regex.
- The test uses the Stripe test card `4242 4242 4242 4242`. Should the migrated test stub the payment provider, or hit the real Stripe test endpoint? v0 mirrors the source (real test endpoint). For CI stability, consider stubbing in a follow-up.
- Currency assertion uses `/^\$\d+/` — does the shop use USD? If the app is multi-currency, the assertion needs to be currency-symbol-aware.

## Risk callouts
- The original spec uses raw `Thread.sleep(1500)` between step
  transitions; the migrated test relies on the NEXT step's first
  element becoming visible. If the app uses CSS transitions that delay
  visibility, the auto-retry will absorb it, but if a step renders
  blank-then-populated, the assertion timing could race.
- POM uses lazy getters (`= () =>`). If the team prefers
  `@playwright/test`'s `PageObjectModel` convention with readonly fields,
  this can be reshaped trivially. Lazy getters are recommended in 2026
  because they avoid stale-element issues across navigations.

## Expected metrics
- Selector quality score: 10/10 role/label-based (was 0/11 id / css /
  xpath via PageFactory).
- Smell count delta: -3 `Thread.sleep`, -1 `WebDriverWait`, -1 PageFactory,
  -1 deep XPath, -1 Actions builder, -2 JUnit assertions, -2 driver setup
  / teardown.
- LOC delta: 77 → 70 (-7 lines; POM trades teardown boilerplate for
  reusable structure).
