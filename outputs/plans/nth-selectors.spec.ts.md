# Migration plan: nth-selectors.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. The source is already Playwright TypeScript; the migration removes anti-patterns (hardcoded URL, `test.only` leftover, hard wait, nth-index selectors, CSS-class selectors, sync probes, wrong import source) and reshapes the flat spec into the qa-master layered architecture (`PageClassProductListing` + `BlockClassCartDrawer` + auto-fixture for route mocking).

**Source file:** `inputs/bad-playwright/nth-selectors.spec.ts`

## Summary

Product listing cart-interaction tests for the Acme Shop storefront. Two scenarios exercise a mocked products API: clicking add-to-cart on a specific product and verifying the header cart badge increments, and removing the only cart item from the open drawer and verifying the empty-state message appears. All `/api/products` responses are stubbed via `page.route` in `beforeEach`.

### What bug does this catch?

Catches a regression where clicking add-to-cart on a product card fails to update the visible cart badge count in the header, or where the remove button in the cart drawer fails to clear the cart and reveal the empty-cart message.

### User-perceivable assertion checklist

- [ ] After clicking add-to-cart on the 3rd product ("Wool Beanie" in the mock): cart badge in the page header displays the text `'1'`
- [ ] After adding the 1st product ("Linen Tee"), opening the cart drawer, and clicking remove: the cart drawer shows an empty-state message

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 1 | KB-1.1.26 | spec-imports-playwright-direct | `import { test, expect } from '@playwright/test'` | `import { test, expect } from '@fixtures/base.fixture'` |
| H | 15 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/products')` | configure `baseURL`; navigate via `productListingPage.open()` on the POM |
| H | 18 | KB-1.1.8 | test.only-leftover | `test.only('adds the third product to the cart')` | `test(...)` — remove `.only`; CI `forbidOnly` blocks this |
| H | 22 | KB-1.1.1 | hard-wait | `page.waitForTimeout(1500)` | delete; rely on `toHaveText` auto-retry on the badge locator |
| H | 25 | KB-1.1.19 | innerText-sync-probe | `expect(await cartBadge.innerText()).toBe('1')` | `await expect(cartBadge).toHaveText(EXPECTED_CART_COUNT)` |
| H | 36 | KB-1.1.5 | isVisible-sync-probe | `expect(await empty.isVisible()).toBe(true)` | `await expect(emptyMessage).toBeVisible()` |
| M | 19 | KB-1.1.3 | css-class-selector | `page.locator('.product-card')` | `page.getByRole('article')` (LOW conf — see pin 1, Q1) |
| M | 20 | KB-1.1.2 | nth-index-selector | `productCards.nth(2)` | `.filter({ hasText: /wool beanie/i })` (LOW conf — see pin 1) |
| M | 20 | KB-1.1.2 | nth-index-selector | `.locator('button').nth(0)` (add-to-cart, test 1) | `.getByRole('button', { name: /add to cart/i })` (LOW conf — see pin 2, Q3) |
| M | 24 | KB-1.1.2 | nth-index-chain | `header > div.nth(1) > span.nth(0)` (cart badge) | `page.getByTestId('cart-count')` (LOW conf — see pin 3, Q4) |
| L | 25 | KB-1.1.9 | magic-string | `toBe('1')` | extract to `const EXPECTED_CART_COUNT = '1'` in `products.ts` |
| M | 29 | KB-1.1.3 | css-class-selector | `page.locator('.product-card').nth(0)` (test 2) | `page.getByRole('article').filter({ hasText: /linen tee/i })` |
| M | 29 | KB-1.1.2 | nth-index-selector | `.nth(0)` on product cards (test 2) | `.filter({ hasText: /linen tee/i })` (LOW conf — see pin 1) |
| M | 29 | KB-1.1.2 | nth-index-selector | `.locator('button').nth(0)` (add-to-cart, test 2) | `.getByRole('button', { name: /add to cart/i })` (LOW conf — see pin 2) |
| M | 30 | KB-1.1.2 | nth-index-selector | `page.locator('header > div').nth(1)` (cart icon) | `page.getByRole('link', { name: /cart/i })` (LOW conf — see pin 4, Q5) |
| M | 32 | KB-1.1.3 | css-class-selector | `page.locator('.cart-drawer li')` | scoped `getByRole('listitem')` within drawer (LOW conf — see pin 5) |
| M | 32 | KB-1.1.2 | nth-index-selector | `.nth(0)` on cart list items | `.filter({ hasText: /linen tee/i })` (LOW conf — see pin 5, Q6) |
| M | 32 | KB-1.1.2 | nth-index-selector | `.locator('button').nth(1)` (remove button) | `.getByRole('button', { name: /remove/i })` (MED conf — see pin 6, Q7) |
| M | 35 | KB-1.1.3 | css-class-selector | `page.locator('.cart-drawer .empty-message')` | `page.getByText(/your cart is empty/i)` (LOW conf — see pin 7, Q8) |

### Unclassified smells

**Smell U1: Heavy `beforeEach` (lines 4–16, 13 lines).** `migration-rules.md §2` limits `beforeEach` to ≤3 lines; anything heavier belongs in a fixture. The combined route mock + navigation block violates this. Fix: lift `page.route('**/api/products*', ...)` into an `auto: true` fixture (`products-mocks.fixture.ts`) so it fires for both tests automatically; move `page.goto` into `PageClassProductListing.open()` called from a one-line `beforeEach`. No KB entry exists for the heavy-beforeEach smell; reviewer should confirm whether to catalog it.

## Locator translation table

No DOM snapshot at `outputs/dom-snapshots/nth-selectors.spec.ts.yaml`. All translations rely on inferred evidence (mock data constants, variable names, CSS class semantics, industry conventions). All nine locators are MED or LOW confidence.

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('.product-card')` | `page.getByRole('article')` | low | `article` is the conventional semantic element for product cards but is not confirmed without a DOM snapshot. Reviewer: verify element tag/role, or request `data-testid="product-card"`. See pin 1, Q1. |
| `productCards.nth(2)` (3rd product) | `.filter({ hasText: /wool beanie/i })` | low | Mock fixes "Wool Beanie" at index 2; name-based filter decouples from DOM order. Assumes product name is rendered inside the card. See pin 1. |
| `.locator('button').nth(0)` (add-to-cart, tests 1 + 2) | `.getByRole('button', { name: /add to cart/i })` | low | Common accessible label; multiple buttons per card are possible (wishlist, compare). `nth(0)` is ambiguous without confirming button accessible name. See pin 2, Q3. |
| `page.locator('header > div').nth(1).locator('span').nth(0)` (cart badge) | `page.getByTestId('cart-count')` | low | Deeply structural positional chain; `data-testid="cart-count"` is guessed from common convention. See pin 3, Q4. |
| `page.locator('.product-card').nth(0)` (1st product, test 2) | `page.getByRole('article').filter({ hasText: /linen tee/i })` | low | Mock places "Linen Tee" at index 0. Same reasoning as `nth(2)` row above. See pin 1. |
| `page.locator('header > div').nth(1)` (cart icon click, test 2) | `page.getByRole('link', { name: /cart/i })` | low | Structural index selector; cart icon could be a `<button>` rather than an `<a>`. See pin 4, Q5. |
| `page.locator('.cart-drawer li').nth(0)` (first cart item) | `page.locator('[data-testid="cart-drawer"]').getByRole('listitem').filter({ hasText: /linen tee/i })` | low | Cart drawer `data-testid` guessed; `listitem` scope within drawer assumed. See pin 5, Q6. |
| `.locator('button').nth(1)` (remove button) | `.getByRole('button', { name: /remove/i })` | med | "Remove" is the industry-standard accessible label; `nth(1)` implies another button at index 0 (likely a quantity control). Pattern is standard but label text is unverified without a DOM snapshot. See pin 6, Q7. |
| `page.locator('.cart-drawer .empty-message')` | `page.getByText(/your cart is empty/i)` | low | Exact empty-state copy is unknown; regex covers the most common variation. See pin 7, Q8. |

**Confidence summary:** 0 HIGH · 1 MED · 8 LOW.

## Hallucination-defense pins

1. **Product card element and product name filter** — assumed `page.getByRole('article').filter({ hasText: /wool beanie/i })` (and `…filter({ hasText: /linen tee/i })` for test 2). If DOM uses `<div>` or `<li>` without an `article` role: keep `page.locator('.product-card')`, add comment `// Q1 unresolved: product card element role not confirmed — assumed article`. Reviewer fallback: verify semantic element type or ask FE team to add `data-testid="product-card"` to each card root.

2. **Add-to-cart button within a product card** — assumed `.getByRole('button', { name: /add to cart/i })` scoped within the product card locator. If no button on the card carries that accessible name (icon-only, aria-hidden label, or label is "Add"/"Buy"): keep `.locator('button').nth(0)`, add comment `// Q3 unresolved: add-to-cart button accessible name not confirmed`. Reviewer fallback: ask FE team to add `aria-label="Add to cart"` or `data-testid="add-to-cart-button"` to the button.

3. **Cart badge count in the page header** — assumed `page.getByTestId('cart-count')`. If no such testid exists: fall back to `page.locator('header').locator('[aria-label*="cart" i]')`, add comment `// Q4 unresolved: cart-count testid not confirmed`. Reviewer fallback: add `data-testid="cart-count"` to the badge `<span>` element; or use `getByRole('status')` if the badge has `role="status"`.

4. **Cart icon / navigation element in the header** — assumed `page.getByRole('link', { name: /cart/i })`. If element is a `<button>`: use `page.getByRole('button', { name: /cart/i })`. If icon-only with no accessible name: keep `page.locator('header > div').nth(1)`, add comment `// Q5 unresolved: cart icon role (link vs button) and name not confirmed`. Reviewer fallback: add `aria-label="Open cart"` to the element.

5. **Cart drawer scope and list item** — assumed `page.locator('[data-testid="cart-drawer"]').getByRole('listitem').filter({ hasText: /linen tee/i })`. If no testid exists on the drawer: fall back to `page.locator('.cart-drawer').getByRole('listitem').filter(...)`, add comment `// Q6 unresolved: cart-drawer testid not confirmed`. Reviewer fallback: add `data-testid="cart-drawer"` to the slide-out panel element.

6. **Remove item button within a cart drawer list item** — assumed `.getByRole('button', { name: /remove/i })`. If button label is "Delete", "×", or aria-hidden icon: keep `.locator('button').nth(1)`, add comment `// Q7 unresolved: remove button accessible name not confirmed`. Reviewer fallback: add `aria-label="Remove item"` or `data-testid="remove-item-button"` to the remove button.

7. **Empty-cart message in the cart drawer** — assumed `page.getByText(/your cart is empty/i)`. If copy differs ("No items in your cart", "Your bag is empty", etc.): keep `page.locator('.cart-drawer .empty-message')`, add comment `// Q8 unresolved: empty-cart message copy not confirmed`. Reviewer fallback: confirm app's empty-cart wording or add `data-testid="cart-empty-message"` to the element.

## Structural changes

### Decision rationale

The source test has 9 distinct locators across two tests, all on a single page URL (`/products`). The cart drawer is an in-page panel (not a separate route), making this a single-page journey with no cross-page action needed. However, the cart drawer section is a distinct UI region with 4 locators (`containerDrawer`, `textEmptyMessage`, `byCartItem`, `byRemoveButton`) and 2 action methods (`removeItem`, `waitForEmpty`), putting it at the boundary of the block extraction threshold (migration-rules §5b: ~5+ locators or 3+ methods). Given that it is a self-contained, semantically named UI component, extracting it as `BlockClassCartDrawer` improves readability and defers cleanly to the page object which stays focused on product-card interactions.

### Files Stage 2 must emit

| Layer | File path | Why it exists |
|---|---|---|
| Spec | `outputs/tests/nth-selectors.spec.ts` | The migrated test — two scenarios, single `test.describe` |
| Page | `outputs/helper/page-object/pages/product-listing.page.ts` | `PageClassProductListing` — product card locators, cart badge, cart icon, add-to-cart action; holds `blockCartDrawer` |
| Block | `outputs/helper/page-object/blocks/cart-drawer.block.ts` | `BlockClassCartDrawer` — 4 locators + 2 action methods; self-contained drawer section |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add `productListingPage: PageClassProductListing` injectable fixture |
| Fixture | `outputs/helper/fixtures/products-mocks.fixture.ts` (new) | `auto: true` fixture lifting `page.route('**/api/products*', …)` out of `beforeEach`; both tests consume it automatically |
| API | (none) | No real data prep — tests exercise the UI against a mocked products API |
| Action | (none) | Single-page journey; cart drawer is an in-page panel |
| Utility | (none) | No DOM-string parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | Add `LABEL_PRODUCT_LISTING = "Product listing"` and `LABEL_CART_DRAWER = "Cart drawer"` |
| Test-data | `outputs/helper/test-data/products.ts` (new) | `PRODUCTS_MOCK_LIST` constant (route stub payload); `EXPECTED_CART_COUNT = '1'`; product name constants `PRODUCT_LINEN_TEE`, `PRODUCT_WOOL_BEANIE` |
| Type | (none) | No new type shapes needed |

### PageClassProductListing (`product-listing.page.ts`)

- `readonly url = '/products'`
- Static locators (each with `.describe('[LABEL_PRODUCT_LISTING] …')`):
  - `arrayProductCards` — collection of product card elements (LOW conf — see pin 1)
  - `textCartBadgeCount` — cart count badge in the header (LOW conf — see pin 3)
  - `linkCart` — cart icon / nav element in the header (LOW conf — see pin 4)
- Parameterised locators:
  - `byProductCard(productName: string)` — `arrayProductCards.filter({ hasText: new RegExp(productName, 'i') })`
  - `byProductAddToCartButton(productName: string)` — `byProductCard(productName).getByRole('button', { name: /add to cart/i })`
- Methods: `open(): Promise<void>`, `waitForPageLoad(): Promise<void>`, `addProductToCart(productName: string): Promise<void>`, `openCart(): Promise<void>`
- Block field: `readonly blockCartDrawer = new BlockClassCartDrawer(this.page)`
- Required constant: `LABEL_PRODUCT_LISTING` from `@test-data/labels`

### BlockClassCartDrawer (`cart-drawer.block.ts`)

- Static locators (each with `.describe('[LABEL_CART_DRAWER] …')`):
  - `containerDrawer` — the cart drawer panel (LOW conf — see pin 5)
  - `textEmptyMessage` — empty-state copy (LOW conf — see pin 7)
- Parameterised locators:
  - `byCartItem(productName: string)` — listitem within drawer, filtered by product name
  - `byRemoveButton(productName: string)` — remove button scoped to a cart item (MED conf — see pin 6)
- Methods: `removeItem(productName: string): Promise<void>`, `waitForEmpty(): Promise<void>`
- Required constant: `LABEL_CART_DRAWER` from `@test-data/labels`

### Spec structure

```
test.describe('Product listing — cart interactions', { tag: ['@positive'] }, () => {
  test.beforeEach(async ({ productListingPage }) => {
    await productListingPage.open();
  });

  // plan:scenario=1.1
  test('[PL-1] - Check that adding a product increments the cart badge count', ...);

  // plan:scenario=1.2
  test('[PL-2] - Check that removing the only cart item shows the empty-cart message',
    { tag: ['@edge'] }, ...);
});
```

`test.beforeEach` is one line; route mock is handled by the `auto: true` `products-mocks.fixture.ts`. No `test.only`. Imports from `@fixtures/base.fixture`. `test.describe` nesting depth: 1 (within the 2-level limit).

### Split into multiple specs

No — both tests share the same page, mock fixture, and feature area (product listing cart interactions). One file is correct.

## Open questions for reviewer

Q1: What is the semantic HTML element for `.product-card`? Is it `<article>`, `<li>`, `<div>`, or something else with an explicit `role` attribute?
Context: Lines 19, 20, 29 — all rely on `.product-card` CSS class for the card container.
What I assumed: `article` role (common for product card components).
Impact if wrong: `getByRole('article')` returns zero elements; every test fails with a misleading "no article found" error that looks like a test infrastructure issue rather than a locator issue.

Q2: The mock data fixes product order (Linen Tee at index 0, Wool Beanie at index 2). Should the migrated test reference products by name constants from `PRODUCTS_MOCK_LIST`, or by a positional alias ("first product", "third product")?
Context: Lines 19–20, 29 — tests select by nth index derived from mock data order.
What I assumed: name-based filter using mock product name constants, to decouple from DOM order.
Impact if wrong: if mock list is reordered independently, name-based filters miss the target silently where nth() would have continued to pass (test reliability regression without a product regression signal).

Q3: Does the add-to-cart button on a product card have an accessible name that distinguishes it from other buttons on the same card (wishlist, quick-view, compare)?
Context: Line 20 — `.locator('button').nth(0)` on a product card. First button is assumed to be add-to-cart.
What I assumed: button accessible name matches `/add to cart/i`.
Impact if wrong: locator throws "no button with that name" OR a different button (wishlist, compare) is clicked — test asserts on a false-positive cart state.

Q4: Does the cart count badge (`header > div.nth(1) > span.nth(0)`) have a `data-testid` attribute, or does it carry `role="status"` or `aria-label`?
Context: Line 24 — deepest positional chain in the file.
What I assumed: `data-testid="cart-count"` exists or can be added.
Impact if wrong: Stage 2 emits a testid locator that finds nothing; cart count assertion always fails, making test 1.1 completely broken.

Q5: Is the cart icon / nav element (currently `header > div.nth(1)`) a `<a>` (link) or a `<button>`? Does it have an accessible name?
Context: Line 30 — `page.locator('header > div').nth(1).click()` opens the cart drawer.
What I assumed: `getByRole('link', { name: /cart/i })`.
Impact if wrong: locator throws a role-mismatch error ("no link named 'cart'") and the cart drawer never opens, breaking test 1.2 entirely.

Q6: Does the cart drawer panel have a `data-testid` attribute that can scope the item locator?
Context: Line 32 — `page.locator('.cart-drawer li').nth(0)`.
What I assumed: `data-testid="cart-drawer"` for scoping (CSS fallback `.cart-drawer` per pin 5 if absent).
Impact if wrong: without explicit scope, a `listitem` elsewhere on the page could match before the drawer's list, causing the wrong element to be targeted.

Q7: What is the exact accessible name of the remove button (currently `button.nth(1)`) in the cart drawer list item?
Context: Line 32 — `.locator('button').nth(1)`.
What I assumed: accessible name matches `/remove/i`.
Impact if wrong: remove button is never found; the `removeItem` action on `BlockClassCartDrawer` always fails, breaking test 1.2.

Q8: What text does `.empty-message` display when the cart is empty?
Context: Line 35 — `page.locator('.cart-drawer .empty-message')`. Source only asserts `isVisible()`; exact copy is unknown.
What I assumed: copy matches `/your cart is empty/i`.
Impact if wrong: `getByText(...)` locates nothing; the final assertion in test 1.2 always fails.

Q9: Was `test.only` on line 18 an accidental leftover, or was it protecting a known-broken scenario 1.2 from CI?
Context: Line 18 — `test.only('adds the third product to the cart')`.
What I assumed: accidental leftover; both tests should run.
Impact if wrong: removing `.only` surfaces a latent failure in test 1.2 that was previously hidden. If test 1.2 is known-broken, Stage 2 should emit `test.skip('... — re-enable after <ticket>...')` rather than a plain `test`.

Q10: Does `/products` require authentication, or is it a public page?
Context: Line 15 — `page.goto('https://shop.acme.test/products')` with no login step.
What I assumed: the product listing page is publicly accessible.
Impact if wrong: Stage 2 must add an `authenticated.fixture.ts`; the current plan structure provides no credentials or session setup.

Q11: Does the `page.route('**/api/products*', ...)` mock also need to cover cart mutation endpoints (POST add-to-cart, DELETE remove)? If not, are those calls expected to hit a live backend?
Context: Lines 4–14 — only the read endpoint (`GET /api/products`) is mocked.
What I assumed: cart mutations go to the test environment's real backend (or are handled transparently).
Impact if wrong: add-to-cart and remove clicks silently no-op if the backend is unavailable; badge and empty-message assertions then time out, masking the actual failure mode.

## Risk callouts

- **Hard-wait masking a real race (High).** `waitForTimeout(1500)` in test 1.1 was likely added because the cart badge update is asynchronous (state management, possible micro-animation). Replacing with `await expect(textCartBadgeCount).toHaveText(EXPECTED_CART_COUNT)` is correct, but if the badge briefly passes through an intermediate visual state before settling on `'1'`, the auto-retry assertion may catch the transient. Verify the badge updates atomically (0 → 1 with no intermediate render).

- **test.only silently skips test 1.2 (High).** Scenario 1.2 has never run in CI in the current source. Its nine locators on lines 29–36 may be broken in the source regardless of anti-pattern removal. Treat test 1.2 as "low CI confidence" until it passes end-to-end after migration — do not treat passing test 1.1 as evidence of overall correctness.

- **Eight LOW-confidence locators (High).** The majority of the locator table is LOW confidence. Until reviewer answers Q1–Q8 (or a DOM snapshot is captured), Stage 2 will emit locators that may not match the SUT DOM. The hallucination-defense pins define safe fallbacks for each, but all seven pins require explicit reviewer sign-off before the migrated test is trusted.

- **Cart state not verified before removal (Medium).** Scenario 1.2 adds Linen Tee and immediately opens the cart without first asserting the badge shows `'1'`. If add-to-cart silently fails (e.g., no live cart API — see Q11), the cart is already empty when the drawer opens, and the "remove then assert empty" assertion passes vacuously (false positive). Mitigation: Stage 2 should add a `toHaveText(EXPECTED_CART_COUNT)` assertion on `textCartBadgeCount` as a pre-condition step before opening the cart drawer.

- **Mock data order coupling (Low).** Both tests rely on mock data ordering (Linen Tee at index 0, Wool Beanie at index 2). Name-based filtering decouples from index, but any rename of products in `PRODUCTS_MOCK_LIST` will silently break the tests without a product regression signal.

- **Route mock pattern breadth (Low).** The glob `**/api/products*` also matches `/api/products/featured`, `/api/products/search`, etc. In the current test this is likely benign (only the listing endpoint fires), but a future test for a search or featured-products feature in the same spec file would be unexpectedly intercepted. Reviewer should confirm the glob is intentionally broad or tighten to `**/api/products` (exact match).

## Expected metrics

- **Selector quality score (estimated post-migration):** 0.56 (5/9 locators expected to reach role/text/testid after reviewer answers to Q1–Q8; 4 are likely structural or CSS fallbacks until FE adds testids / aria attributes)
- **Smell count delta vs source:** −6 H + −12 M + −1 L = **−19 smells removed, +0 new smells introduced**
- **LOC estimate:** ~55 (spec) + ~80 (`product-listing.page.ts`) + ~70 (`cart-drawer.block.ts`) + ~30 (`products-mocks.fixture.ts`) + ~20 (test-data files) = ~255 total output; source was 38 LOC; net delta ≈ +217
- **Anti-pattern coverage:** 19/19 cataloged
