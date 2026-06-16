# Migration plan: nth-selectors.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes anti-patterns (nth-index selectors, CSS-class selectors, hard waits, sync probes, `test.only`, hardcoded URL) and reshapes the flat spec into the qa-master layered architecture (`PageClassProductListing` + `BlockClassCartDrawer` + auto-fixture for route mocking).

**Source file:** `inputs/bad-playwright/nth-selectors.spec.ts`

## Summary

Product listing cart interaction tests for the Acme Shop storefront. Two scenarios: clicking add-to-cart on a specific product increments the cart badge count shown in the header, and removing that product from an open cart drawer reveals the empty-cart message. Both tests use a `page.route` stub to avoid real network dependency on the products API.

### What bug does this catch?

Catches a regression where clicking add-to-cart on a product or removing the only item from the cart drawer fails to update the visible cart state — specifically the badge count in the header and the empty-state message in the cart panel.

### User-perceivable assertion checklist

- [ ] After clicking add-to-cart on the 3rd product (Wool Beanie in mock): cart badge in the page header shows the text `'1'`
- [ ] After adding the 1st product (Linen Tee in mock), opening the cart drawer, and removing it: the cart drawer shows an empty-state message

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 1 | KB-UNCLASSIFIED | wrong-import-source | `import { test, expect } from '@playwright/test'` | `import { test, expect } from '@fixtures/base.fixture'` |
| H | 15 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/products')` | configure `baseURL`; navigate via `productListingPage.open()` |
| H | 18 | KB-1.1.8 | test.only-leftover | `test.only('adds the third product…')` | `test(...)` — remove `.only` so both tests run in CI |
| H | 22 | KB-1.1.1 | hard-wait | `page.waitForTimeout(1500)` | web-first assertion on cart badge reflecting new count |
| H | 25 | KB-1.1.19 | innerText-sync-probe | `expect(await cartBadge.innerText()).toBe('1')` | `await expect(cartBadge).toHaveText(EXPECTED_CART_COUNT)` |
| H | 36 | KB-1.1.5 | isVisible-sync-probe | `expect(await empty.isVisible()).toBe(true)` | `await expect(emptyMessage).toBeVisible()` |
| M | 19 | KB-1.1.3 | css-class | `page.locator('.product-card')` | `page.getByRole('article')` or `getByTestId(...)` — LOW conf, see pins |
| M | 20 | KB-1.1.2 | nth-selector | `productCards.nth(2)` | `.filter({ hasText: /wool beanie/i })` — LOW conf, see pin 1 |
| M | 20 | KB-1.1.2 | nth-selector | `.locator('button').nth(0)` (add-to-cart, test 1) | `.getByRole('button', { name: /add to cart/i })` — LOW conf, see pin 2 |
| M | 24 | KB-1.1.2 | nth-selector | `header > div.nth(1) > span.nth(0)` (cart badge) | `page.getByTestId('cart-count')` — LOW conf, see pin 3 |
| M | 25 | KB-1.1.9 | magic-string | `toBe('1')` | extract to `const EXPECTED_CART_COUNT = '1'` |
| M | 29 | KB-1.1.3 | css-class | `page.locator('.product-card').nth(0)` (test 2) | `page.getByRole('article').filter({ hasText: /linen tee/i })` |
| M | 29 | KB-1.1.2 | nth-selector | `.nth(0)` on product cards (test 2) | `.filter({ hasText: /linen tee/i })` — LOW conf |
| M | 29 | KB-1.1.2 | nth-selector | `.locator('button').nth(0)` (add-to-cart, test 2) | `.getByRole('button', { name: /add to cart/i })` — LOW conf |
| M | 30 | KB-1.1.2 | nth-selector | `page.locator('header > div').nth(1)` (cart icon) | `page.getByRole('link', { name: /cart/i })` — LOW conf, see pin 4 |
| M | 32 | KB-1.1.3 | css-class | `page.locator('.cart-drawer li')` | scoped `getByRole('listitem')` within drawer — LOW conf |
| M | 32 | KB-1.1.2 | nth-selector | `.nth(0)` on cart list items | `.filter({ hasText: /linen tee/i })` — LOW conf, see pin 5 |
| M | 32 | KB-1.1.2 | nth-selector | `.locator('button').nth(1)` (remove button) | `.getByRole('button', { name: /remove/i })` — MED conf, see pin 6 |
| M | 35 | KB-1.1.3 | css-class | `page.locator('.cart-drawer .empty-message')` | `page.getByText(/your cart is empty/i)` — LOW conf, see pin 7 |

### Unclassified smells

**Wrong import source (line 1).** Importing `test`/`expect` directly from `@playwright/test` in a spec file violates the qa-master hard rule (`migration-rules.md §2`, `helper/fixtures/CLAUDE.md`): only `outputs/helper/fixtures/base.fixture.ts` may import from `@playwright/test`; every spec must re-export from `@fixtures/base.fixture`. This pattern is not yet cataloged in `config/knowledge-base.md`. Reviewer should confirm whether to add `KB-1.1.26: wrong-import-source` to the catalog.

**Heavy `beforeEach` (lines 4–16).** The `beforeEach` spans 13 lines (route stub + navigation), violating the ≤3-line rule (`migration-rules.md §2`). Fix: lift the `page.route('**/api/products*', ...)` stub into an auto-fixture (`products-mocks.fixture.ts`) and move `page.goto` into `PageClassProductListing.open()`. The output `beforeEach` becomes at most a single `await productListingPage.open()` call or is removed entirely if navigation moves to a per-test `test.step`.

## Locator translation table

No DOM snapshot present at `outputs/dom-snapshots/nth-selectors.spec.ts.yaml`. All translations rely on inferred evidence (variable names, CSS class semantics, mock data constants, industry conventions). All nine locators are MED or LOW confidence.

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('.product-card')` | `page.getByRole('article')` | low | `article` is common for product cards but not confirmed without DOM snapshot. Reviewer: verify element tag/role or request `data-testid="product-card"`. |
| `productCards.nth(2)` (3rd product) | `.filter({ hasText: /wool beanie/i })` | low | Mock positions "Wool Beanie" at index 2; name-based filter decouples from DOM order. Filter text must match mock constant. See pin 1. |
| `.locator('button').nth(0)` (add-to-cart, test 1 + test 2) | `.getByRole('button', { name: /add to cart/i })` | low | Common accessible label; multiple buttons per card are possible (wishlist, compare). nth(0) is ambiguous. See pin 2. |
| `page.locator('header > div').nth(1).locator('span').nth(0)` (cart badge) | `page.getByTestId('cart-count')` | low | Deeply structural path; `data-testid="cart-count"` is guessed from common convention. Reviewer: confirm testid or add one. See pin 3. |
| `page.locator('.product-card').nth(0)` (1st product, test 2) | `page.getByRole('article').filter({ hasText: /linen tee/i })` | low | Mock places "Linen Tee" at index 0. Same reasoning as nth(2) row. See pin 1. |
| `page.locator('header > div').nth(1)` (cart icon click, test 2) | `page.getByRole('link', { name: /cart/i })` | low | Structural index selector; cart icon may be a `<button>` rather than a link. See pin 4. |
| `page.locator('.cart-drawer li').nth(0)` (first cart item) | `page.locator('[data-testid="cart-drawer"]').getByRole('listitem').filter({ hasText: /linen tee/i })` | low | Cart drawer testid assumed; listitem scope within drawer assumed. See pin 5. |
| `.locator('button').nth(1)` (remove button, test 2) | `.getByRole('button', { name: /remove/i })` | med | "Remove" is the industry-standard accessible label; nth(1) implies another button at index 0 (possibly a quantity control). MED: pattern is standard but label text unverified without DOM snapshot. See pin 6. |
| `page.locator('.cart-drawer .empty-message')` | `page.getByText(/your cart is empty/i)` | low | Exact empty-state copy is unknown; regex covers the most common variation. See pin 7. |

## Hallucination-defense pins

1. **Product card element and product name filter** — assumed `page.getByRole('article').filter({ hasText: /wool beanie/i })` (and `…filter({ hasText: /linen tee/i })` for test 2). If DOM uses `<div>` or `<li>` without an `article` role: keep `page.locator('.product-card')`, add WHY-comment `'Q1 unresolved: product card element role not confirmed'`. Reviewer fallback: ask FE team for semantic element type or add `data-testid="product-card"` to each card.

2. **Add-to-cart button** — assumed `.getByRole('button', { name: /add to cart/i })` scoped within a product card. If no button on the card has that accessible name (icon-only button, aria-hidden label): keep `.locator('button').nth(0)`, add WHY-comment `'Q3 unresolved: add-to-cart button accessible name not confirmed'`. Reviewer fallback: ask FE team to add `aria-label="Add to cart"` or `data-testid="add-to-cart-button"` to the button.

3. **Cart badge count** — assumed `page.getByTestId('cart-count')`. If no such testid exists in the DOM: fall back to `page.locator('header').locator('[aria-label*="cart" i]')`, add WHY-comment `'Q4 unresolved: cart-count testid not confirmed'`. Reviewer fallback: add `data-testid="cart-count"` to the badge `<span>` element.

4. **Cart icon / nav element** — assumed `page.getByRole('link', { name: /cart/i })`. If the cart icon is a `<button>` rather than an `<a>`: use `page.getByRole('button', { name: /cart/i })` instead; if neither matches (icon-only, aria-hidden): keep `page.locator('header > div').nth(1)`, add WHY-comment `'Q5 unresolved: cart icon role (link vs button) not confirmed'`. Reviewer fallback: add `aria-label="Open cart"` to the element.

5. **Cart drawer scope and cart item** — assumed `page.locator('[data-testid="cart-drawer"]').getByRole('listitem').filter({ hasText: /linen tee/i })`. If no testid on the drawer: fall back to `page.locator('.cart-drawer').getByRole('listitem').filter(...)`, add WHY-comment `'Q6 unresolved: cart-drawer testid not confirmed'`. Reviewer fallback: add `data-testid="cart-drawer"` to the slide-out panel element.

6. **Remove button** — assumed `.getByRole('button', { name: /remove/i })`. If remove button has a different label ("Delete", "×", or aria-hidden icon): keep `.locator('button').nth(1)`, add WHY-comment `'Q7 unresolved: remove button accessible name not confirmed'`. Reviewer fallback: add `aria-label="Remove item"` or `data-testid="remove-item-button"` to the remove button.

7. **Empty cart message** — assumed `page.getByText(/your cart is empty/i)`. If actual copy differs (e.g. "No items in your cart", "Your bag is empty"): keep `page.locator('.cart-drawer .empty-message')`, add WHY-comment `'Q8 unresolved: empty-cart message copy not confirmed'`. Reviewer fallback: confirm app's empty-cart wording or add `data-testid="cart-empty-message"` to the element.

## Structural changes

### Files Stage 2 must emit

| Layer | File path | Why it exists |
|---|---|---|
| Spec | `outputs/tests/nth-selectors.spec.ts` | The migrated test — two scenarios, single `test.describe` |
| Page | `outputs/helper/page-object/pages/product-listing.page.ts` | `PageClassProductListing` — owns product card locators, cart icon/badge, add-to-cart action, and holds `blockCartDrawer` |
| Block | `outputs/helper/page-object/blocks/cart-drawer.block.ts` | `BlockClassCartDrawer` — 4 locators + 2 action methods meets the ≥3-method block extraction threshold; the drawer is a self-contained in-page section |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | add `productListingPage: PageClassProductListing` injectable fixture |
| Fixture | `outputs/helper/fixtures/products-mocks.fixture.ts` (new) | `auto: true` fixture lifting `page.route('**/api/products*', …)` out of `beforeEach`; both tests use it automatically |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | add `LABEL_PRODUCT_LISTING = "Product listing"` and `LABEL_CART_DRAWER = "Cart drawer"` |
| Test-data | `outputs/helper/test-data/products.ts` (new) | `PRODUCTS_MOCK_LIST` constant (the route stub payload); `EXPECTED_CART_COUNT = '1'` |
| API | (none) | No data prep via API — tests exercise the UI flow against a mocked products API |
| Action | (none) | Single-page journey; cart drawer is an in-page panel, not a separate page object |
| Utility | (none) | No DOM-string parsing required; cart count is asserted as plain text |
| Type | (none) | n/a |

### PageClassProductListing (`product-listing.page.ts`)

- `readonly url = '/products'`
- Static locators (each with `.describe('[LABEL_PRODUCT_LISTING] …')`):
  - `arrayProductCards` — collection of product card elements (LOW conf role, see pin 1)
  - `textCartBadgeCount` — cart count badge in the header (LOW conf testid, see pin 3)
  - `linkCart` — cart icon / navigation link in the header (LOW conf role, see pin 4)
- Parameterised locators:
  - `byProductCard(productName: string)` — `arrayProductCards.filter({ hasText: new RegExp(productName, 'i') })`
  - `byProductAddToCartButton(productName: string)` — `byProductCard(productName).getByRole('button', { name: /add to cart/i })`
- Methods: `open(): Promise<void>`, `waitForPageLoad(): Promise<void>`, `addProductToCart(productName: string): Promise<void>`, `openCart(): Promise<void>`
- Block field: `readonly blockCartDrawer = new BlockClassCartDrawer(this.page)`
- Required constant: `LABEL_PRODUCT_LISTING` imported from `@test-data/labels`

### BlockClassCartDrawer (`cart-drawer.block.ts`)

- Static locators (each with `.describe('[LABEL_CART_DRAWER] …')`):
  - `containerDrawer` — the cart drawer panel (LOW conf testid, see pin 5)
  - `textEmptyMessage` — empty-state copy (LOW conf text, see pin 7)
- Parameterised locators:
  - `byCartItem(productName: string)` — listitem within drawer filtered by product name
  - `byRemoveButton(productName: string)` — remove button scoped within a cart item (MED conf, see pin 6)
- Methods: `removeItem(productName: string): Promise<void>`, `waitForEmpty(): Promise<void>`
- Required constant: `LABEL_CART_DRAWER` imported from `@test-data/labels`

### Spec structure

```
test.describe('Product listing — cart interactions', { tag: ['@positive'] }, () => {
  test.beforeEach(async ({ productListingPage }) => {
    await productListingPage.open();
  });

  test('[PL-1] - Check that adding a product increments the cart badge count', ...);
  test('[PL-2] - Check that removing the only cart item shows the empty-cart message', { tag: ['@edge'] }, ...);
});
```

`test.beforeEach` is one line; route mock is handled by `products-mocks.fixture.ts` (`auto: true`). No `test.only`. Import from `@fixtures/base.fixture`.

### Split into multiple specs

No — both tests share the same page, the same route mock fixture, and exercise the same feature area (product listing cart interactions). Keeping them in one file is correct.

## Open questions for reviewer

Q1: What is the semantic HTML element for `.product-card`? Is it `<article>`, `<li>`, `<div>`, or something else?
Context: Line 19 — `page.locator('.product-card')`.
What I assumed: `article` role (common for product card components).
Impact if wrong: `getByRole('article')` finds zero elements; test fails with a misleading "no article found" error instead of pointing at a locator issue.

Q2: The mock data fixes the product order (Linen Tee at index 0, Wool Beanie at index 2). Should the migrated test reference products by the name constants from `PRODUCTS_MOCK_LIST`, or should it reference them by a positional alias ("first product", "third product")?
Context: Lines 19–20, 29 — tests select by nth index.
What I assumed: name-based filter using mock product names to decouple from DOM order.
Impact if wrong: if mock data order changes independently, a name-based filter will fail where the original nth() would have passed silently.

Q3: Does the add-to-cart button on a product card have an accessible name (visible text or `aria-label`) that distinguishes it from other buttons on the same card (wishlist, quick-view, compare)?
Context: Line 20 — `.locator('button').nth(0)` on a product card.
What I assumed: accessible name matching `/add to cart/i`.
Impact if wrong: either the locator throws "no button found" or, more dangerously, a different button is clicked — the test would assert on a false-positive cart state.

Q4: Is the cart count badge (`header > div nth(1) > span nth(0)`) reachable via a `data-testid` attribute?
Context: Line 24 — deepest structural chain in the file.
What I assumed: `data-testid="cart-count"` exists or can be added.
Impact if wrong: Stage 2 must fall back to a structural locator with a WHY-comment; any header layout change later breaks the test.

Q5: Is the cart icon / nav element a `<a>` (link) or a `<button>`? (It's currently reached as `header > div nth(1)`.)
Context: Line 30 — `page.locator('header > div').nth(1).click()`.
What I assumed: `getByRole('link', { name: /cart/i })`.
Impact if wrong: locator throws "no matching element" with a confusing role-mismatch error.

Q6: Does the cart drawer panel have a `data-testid` attribute (e.g. `data-testid="cart-drawer"`) that can scope the item locator?
Context: Line 32 — `page.locator('.cart-drawer li').nth(0)`.
What I assumed: `data-testid="cart-drawer"` for scoping (or `.cart-drawer` CSS fallback per pin 5).
Impact if wrong: without an explicit scope, a listitem on the rest of the page could match before the drawer's item, causing the wrong element to be targeted.

Q7: What is the exact copy text for the empty-cart state?
Context: Line 35 — `page.locator('.cart-drawer .empty-message')`. Source only asserts `isVisible()`; text content is unverified.
What I assumed: copy matches `/your cart is empty/i`.
Impact if wrong: `getByText(/your cart is empty/i)` returns no element; the empty-state assertion silently fails.

Q8: Was `test.only` on line 18 an accidental leftover, or does the "removes a product" test have a known failure that motivated the focus?
Context: Line 18 — `test.only('adds the third product to the cart', ...)`.
What I assumed: accidental leftover; both tests should run in CI.
Impact if wrong: if test 2 is known-broken, removing `.only` will cause a CI failure. It would need `test.skip` with a tracked-ticket reference instead.

Q9: Does the `page.route('**/api/products*', ...)` mock also cover cart mutation API calls (POST to add an item, DELETE to remove an item), or will those requests hit a real backend during the test?
Context: Lines 4–14 — only the read endpoint is mocked.
What I assumed: cart mutation calls go to the real backend (or the test environment handles them).
Impact if wrong: if the test environment has no live cart API, add-to-cart clicks will silently no-op — the badge will never update and the test will time out on the web-first assertion.

Q10: Is `/products` a public page, or does accessing it require authentication?
Context: Line 15 — `page.goto('https://shop.acme.test/products')` with no login setup.
What I assumed: the products page is publicly accessible.
Impact if wrong: Stage 2 must add an `authenticated.fixture.ts`; the current test structure provides no credentials.

## Risk callouts

- **Partial route mocking (likely the root cause of `waitForTimeout`).** Only `**/api/products*` is stubbed. If cart mutation calls (add/remove) also need mocking, clicking add-to-cart may silently fail when there is no real backend — and the original `waitForTimeout(1500)` may have been masking exactly this race. Replacing the hard wait with a web-first assertion will expose any backend dependency as a timeout failure, which is the correct signal but may surprise CI if the backend is unavailable.

- **test.only silently skips scenario 1.2.** The "removes a product" test has never been validated by CI in the current source state. After removing `.only`, it will run for the first time; latent failures may surface.

- **Mock data order coupling.** Tests currently select products by DOM index (nth(0), nth(2)), which is implicitly coupled to the mock array order. The plan migrates to name-based filtering (`/linen tee/i`, `/wool beanie/i`) keyed to `PRODUCTS_MOCK_LIST`. If the mock list is changed independently of the test (e.g. product names updated), the filters silently miss the target element.

- **Cart state not verified before removal.** Scenario 1.2 adds a product and immediately opens the cart without asserting the badge count first. If the add-to-cart call fails silently (see risk 1), the cart will already be empty and the subsequent "remove then assert empty" test will pass vacuously (false-positive).

- **Assertion too weak on cart badge.** The source asserts `toBe('1')` — a string equality. If the badge renders a localized count (e.g. "(1)") the assertion fails for a non-bug. The plan promotes to `toHaveText(EXPECTED_CART_COUNT)` with the constant `= '1'`; reviewer should confirm the badge renders bare digits.

## Expected metrics

- **Selector quality score (estimated):** 0.56 (5/9 locators expected to resolve to role/text/testid after pin resolution; 4 are likely to remain structural/class fallbacks until FE adds testids or aria attributes)
- **Smell count delta:** −6 H-severity + −12 M-severity + −1 L-severity = **−19 smells removed, +0 introduced**
- **New spec LOC estimate:** ~55 (within the 300-LOC hard limit)
- **POM LOC estimate:** ~80 (`product-listing.page.ts`) + ~70 (`cart-drawer.block.ts`) = ~150 across helper files
- **Anti-pattern coverage:** 19/19 cataloged
