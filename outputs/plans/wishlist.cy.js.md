# Migration plan: wishlist.cy.js

## Source framework

cypress

Source file is a Cypress test suite (`describe` / `it` / `cy.*` API, `.cy.js`
extension). Cypress version not pinned in source; no `package.json` sibling.
Target: Playwright TypeScript, latest stable (v1.x, 2026 conventions),
qa-master layered architecture.

## Summary

The test exercises the Acme Shop wishlist add/remove flow: a user on the
products listing page clicks "Add to wishlist" on a product card, sees a
confirmation toast, checks the header badge count, navigates to the wishlist
page, and in a second scenario removes the item and verifies the empty state.
Both scenarios are E2E against a live backend (no network stubs in the source).
Migration will introduce API-level wishlist seeding for the remove scenario so
the UI-add flow is exercised exactly once (in scenario 1.1).

### What bug does this catch?

Catches a regression where the wishlist add/remove UI flow silently fails —
the "Add to wishlist" button fires but the badge count does not update, no
toast appears, the wishlist page does not list the item, or the remove button
does not restore the empty state.

### User-perceivable assertion checklist

- [ ] After clicking "Add to wishlist" on a product card: toast "Added to
      wishlist" is visible.
- [ ] After add: header wishlist count badge shows the text `1`.
- [ ] After navigating to the wishlist page (wishlist API response received):
      exactly 1 wishlist item is displayed.
- [ ] After clicking the remove button on the single wishlist item: the empty
      wishlist message is visible.
- [ ] After remove: header wishlist count badge shows the text `0`.

---

## Anti-patterns detected

| Severity | Lines | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 13 | KB-1.2.1 | hard-wait in `beforeEach` | `cy.wait(1500)` | Remove; web-first assertion on the first visible product card in `waitForPageLoad()`. |
| H | 20 | KB-1.2.1 | hard-wait after add-to-wishlist click | `cy.wait(1000)` | Remove; `await expect(productsPage.textToastAddedToWishlist).toBeVisible()` auto-polls. |
| H | 27 | KB-1.2.1 | hard-wait after network alias | `cy.wait(2000)` | Remove; `wishlistPage.waitForPageLoad()` web-first assertion replaces post-response sleep. |
| H | 36 | KB-1.2.1 | hard-wait after add click in test 2 | `cy.wait(1200)` | Same as line 20 — remove; toast assertion or `waitForResponse` covers it. |
| H | 39 | KB-1.2.1 | hard-wait after network alias | `cy.wait(2000)` | Same as line 27 — remove. |
| H | 45 | KB-1.2.1 | hard-wait after remove click | `cy.wait(1500)` | Remove; `await expect(wishlistPage.textEmptyMessage).toBeVisible()` is the gating assertion. |
| H | 43-45 | KB-1.1.12 | conditional test logic (always-truthy) | `if (cy.get(…).should('exist')) {…}` | Remove the `if` wrapper entirely. `cy.get(…).should('exist')` returns a Cypress Chainable (always truthy), so the branch always executes — it is NOT conditional. The comment "silently move on" is incorrect: `should('exist')` FAILS the test if absent. Replace with a direct click: `await wishlistPage.buttonRemoveFromWishlist.first().click()`. |
| M | 9 | KB-1.2.13 | viewport magic numbers in test | `cy.viewport(1366, 768)` | Remove; set `viewport: { width: 1366, height: 768 }` in a named Playwright project in `playwright.config.ts`. |
| M | 10 | KB-1.2.7 | `cy.intercept` without response stub | `cy.intercept('GET', '/api/wishlist')` | Translate to `page.waitForResponse('**/api/wishlist')` created **before** the navigation click. No stub added — test remains E2E. See Q8. |
| M | 26, 38 | KB-1.2.36 | `cy.wait('@alias')` without explicit timeout | `cy.wait('@wishlistLoad')` | Translate to `page.waitForResponse(r => r.url().includes('/api/wishlist'), { timeout: 15_000 })`. |
| M | 16, 33 | KB-1.2.2 | index-based selector `.eq(N)` | `…article.product-card').eq(0)` / `.eq(2)` | Use `getByRole('article').first()` with a `// TODO: fragile — add data-testid per Q6` comment. No accessible product name is available; see Q6. |
| M | 29 | KB-UNCLASSIFIED | Cypress `.its('length').should('eq', N)` count idiom | `…wishlist-item').its('length').should('eq', 1)` | Replace with `await expect(wishlistPage.arrayWishlistItems).toHaveCount(1)`. Cypress's idiom auto-retries; Playwright's `toHaveCount` is the web-first equivalent. See "Unclassified smells" below. |
| L | 16, 33 | KB-1.2.3 | CSS-class primary selector (product card) | `div.product-grid article.product-card` | `page.getByRole('article')` — role is inferable from `article` element; name unknown; see Q6. |
| L | 17, 44 | KB-1.2.3 | CSS-class primary selector (add/remove button) | `button.add-to-wishlist` / `button.remove-from-wishlist` | `page.getByRole('button', { name: /add to wishlist/i })` and `getByRole('button', { name: /remove/i })` — MED confidence; see Q1, Q9. |
| L | 23 | KB-1.2.3 | `cy.contains(text)` used as both locator and assertion | `cy.contains('Added to wishlist').should('be.visible')` | `await expect(productsPage.textToastAddedToWishlist).toBeVisible()` — web-first; role classification of toast uncertain; see Q11. |
| L | 25, 49 | KB-1.2.3 | CSS-class primary selector (header badge) | `.header-wishlist-count` | `page.locator('.header-wishlist-count')` fallback — no testid or aria evidence; see Q4. LOW confidence; see pin 3. |
| L | 26, 38 | KB-1.2.3 | CSS anchor + class selector (header link) | `a.header-wishlist-link` | `page.getByRole('link', { name: /wishlist/i })` — MED confidence; `a` element confirms link role; see Q5. |
| L | 29 | KB-1.2.3 | CSS-class parent + child (wishlist items) | `.wishlist-page .wishlist-item` | `page.locator('.wishlist-item')` fallback — role unknown; `getByRole('listitem')` if `<li>`; see Q2, pin 4. |
| L | 44 | KB-1.2.3 | CSS-class remove button (duplicate selector) | `.wishlist-item button.remove-from-wishlist` | Same as line 17/44 — `getByRole('button', { name: /remove/i })`; see Q9, pin 2. |
| L | 48 | KB-1.2.3 | CSS-class empty message | `.empty-wishlist-message` | `page.getByText(/your wishlist is empty/i)` — text content is guessed; see Q3, pin 5. |

### Unclassified smells

**Cypress `.its('length').should('eq', N)` count pattern (line 29).** In Cypress
this is a valid auto-retrying count assertion equivalent to `.should('have.length', N)`.
No KB entry covers the Cypress-to-Playwright count idiom translation directly
(KB-1.1.18 covers the Playwright `.all()` + loop anti-pattern, not the Cypress
form). Reviewer: confirm this is correctly classified as a translation idiom (not a
Cypress anti-pattern) and note in the KB as `KB-1.2.XX` if warranted.

---

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `cy.get('div.product-grid article.product-card').eq(0)` | `page.getByRole('article').first()` | low | `article` HTML element → implicit ARIA role `article`. No accessible name; `.first()` is still index-based. See pin 1. DOM snapshot absent. |
| `cy.get('div.product-grid article.product-card').eq(2)` | `page.getByRole('article').nth(2)` | low | Same reasoning as eq(0). `.nth(2)` is fragile; product at position 2 may shift. See pin 1 and Q6. |
| `cy.get('button.add-to-wishlist')` (within product card) | `page.getByRole('button', { name: /add to wishlist/i })` | med | `button` element → button role is definitive. Accessible name inferred from class name; could be an icon button with aria-label. See pin 2 and Q1. |
| `cy.contains('Added to wishlist')` | `page.getByText('Added to wishlist')` | med | Text is literal; Playwright `getByText` with exact string is high-precision. Toast may have `role="status"` or `role="alert"`, which would upgrade to `getByRole`; see Q11, pin 6. |
| `cy.get('.header-wishlist-count')` | `page.locator('.header-wishlist-count')` | low | CSS-class only; no testid, no ARIA role evidence. Count badge elements vary widely (spans, sup elements, aria-live regions). Recommend `data-testid="header-wishlist-count"` from FE team; see pin 3 and Q4. |
| `cy.get('a.header-wishlist-link')` | `page.getByRole('link', { name: /wishlist/i })` | med | `a` element → link role is definitive. Accessible name assumed from class name "header-wishlist-link" → likely text or aria-label containing "Wishlist". See pin 7 and Q5. |
| `cy.get('.wishlist-page .wishlist-item')` | `page.locator('.wishlist-item')` | low | CSS-class only. If rendered as `<li>`, `getByRole('listitem')` is preferred; if `<article>`, `getByRole('article')`. Current fallback: CSS class selector. See pin 4 and Q2. |
| `cy.get('.wishlist-item button.remove-from-wishlist').first()` | `page.getByRole('button', { name: /remove from wishlist/i }).first()` | med | `button` element → button role is definitive. Accessible name inferred from class name; `.first()` remains index-based for single-item wishlist (acceptable here since test ensures exactly 1 item). See pin 2 and Q9. |
| `cy.get('.empty-wishlist-message')` | `page.getByText(/your wishlist is empty/i)` | low | CSS-class only; actual text content unknown. Guessed "your wishlist is empty" as a common empty-state message. If wrong, whole assertion breaks silently (no match ≠ fail in Playwright without `toBeVisible()`). See pin 5 and Q3. |

---

## Hallucination-defense pins

1. **Product card (index-based)** — assumed `page.getByRole('article').first()` / `.nth(2)`. If DOM has no implicit `article` role (e.g., `<div class="product-card">`): keep `page.locator('.product-card').first()` / `.nth(2)`, add WHY-comment `'Q6 unresolved: no accessible product name; index fallback'`. Reviewer fallback: request `data-testid="product-card"` from FE team and replace with `page.getByTestId('product-card').first()`.

2. **Add-to-wishlist / remove-from-wishlist button accessible name** — assumed `getByRole('button', { name: /add to wishlist/i })` and `getByRole('button', { name: /remove from wishlist/i })`. If buttons are icon-only (no accessible name): keep `page.locator('button.add-to-wishlist')` and `page.locator('button.remove-from-wishlist')`, add WHY-comment `'Q1/Q9 unresolved: icon button with no accessible name — CSS class fallback'`. Reviewer fallback: request `aria-label="Add to wishlist"` from FE team.

3. **Header wishlist count badge** — assumed `page.locator('.header-wishlist-count')` (CSS fallback). If badge exposes a `data-testid` or `aria-label`: upgrade to `page.getByTestId('header-wishlist-count')` (HIGH) or `page.getByRole('status', { name: /wishlist count/i })`. WHY-comment: `'Q4 unresolved: count badge has no testid or ARIA evidence — CSS class fallback'`. Reviewer fallback: request `data-testid="header-wishlist-count"` from FE team.

4. **Wishlist item elements** — assumed `page.locator('.wishlist-item')` (CSS fallback). If rendered as `<li>`: upgrade to `page.getByRole('listitem')` (HIGH). If `<article>`: `page.getByRole('article')`. WHY-comment: `'Q2 unresolved: wishlist item element type unknown — CSS class fallback'`. Reviewer fallback: check rendered HTML and upgrade to role-based, or request `data-testid="wishlist-item"`.

5. **Empty wishlist message text** — assumed `page.getByText(/your wishlist is empty/i)`. If actual text differs (e.g., "No items saved yet"): keep `page.locator('.empty-wishlist-message')`, add WHY-comment `'Q3 unresolved: empty-state text content unknown — CSS class fallback'`. Reviewer fallback: check app copy and supply exact text or regex.

6. **"Added to wishlist" toast element type** — assumed `page.getByText('Added to wishlist')`. If toast has `role="status"` or `role="alert"`: upgrade to `page.getByRole('status').filter({ hasText: 'Added to wishlist' })` (HIGH). WHY-comment: `'Q11 unresolved: toast ARIA role unknown — text fallback'`. Reviewer fallback: inspect toast component and upgrade to role-based selector.

7. **Header wishlist link accessible name** — assumed `page.getByRole('link', { name: /wishlist/i })`. If accessible name doesn't contain "Wishlist" (e.g., icon-only link): keep `page.locator('a.header-wishlist-link')`, add WHY-comment `'Q5 unresolved: link accessible name unknown — CSS class fallback'`. Reviewer fallback: check rendered `<a>` element for text content or `aria-label`.

---

## Structural changes

### Decision rationale

This migration covers 2 scenarios that span 2 pages (Products, Wishlist) and a
shared header element (wishlist count badge + link). The header has only 2
locators, below the 5-locator / 3-method block extraction threshold and below
the 3-page reuse threshold — header fields go inline on each relevant page
class. No block extraction; flag for future extraction when more pages adopt it.

Scenario 1.2 (remove flow) uses the UI to add a product as setup before the
assertion under test (removing). Per qa-master discipline, data-prep via UI is
forbidden when a non-UI path exists. An API wrapper (`wishlist.api.ts`) is
therefore required for scenario 1.2 setup — endpoint and auth shape are open
questions; see Q7.

No `helper/actions/` file: the cross-page navigation (`productsPage →
wishlistPage`) is a single navigation method on `PageClassProducts` returning
`PageClassWishlist` with `waitForPageLoad()` already awaited — per the
migration-rules §3 "Navigation methods return the destination POM (never void)"
convention. Cross-page actions files are appropriate for multi-step journeys;
a single link click that returns a POM stays on the origin page.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Spec | `outputs/tests/wishlist.spec.ts` | Migrated test — 2 scenarios |
| Page | `outputs/helper/page-object/pages/products.page.ts` | ProductsPage: product card, add-to-wishlist btn, toast, header count badge (inline), header link (nav returns WishlistPage) |
| Page | `outputs/helper/page-object/pages/wishlist.page.ts` | WishlistPage: wishlist items, remove button, empty-state message, header count badge (inline) |
| Block | (none) | Header has 2 locators on 2 pages — below 5-locator and 3-page thresholds; inline on each page |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Inject `productsPage: PageClassProducts`, `wishlistPage: PageClassWishlist` |
| API | `outputs/helper/api/wishlist.api.ts` | Add product to wishlist via API for scenario 1.2 setup; endpoint TBD — see Q7 |
| Action | (none) | Single link-click navigation stays on POM; no multi-step cross-page flow |
| Utility | (none) | No DOM string parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | Add `LABEL_PRODUCTS = "Products"`, `LABEL_WISHLIST = "Wishlist"` |
| Type | (none) | No new external API response shapes needed at this stage |

### `PageClassProducts` — proposed fields and methods

- `readonly url = '/products'`
- `readonly headingProducts` — page heading; web-first guard in `waitForPageLoad()`
- `readonly buttonAddToWishlist` — `getByRole('button', { name: /add to wishlist/i })` — MED (pin 2)
- `readonly textToastAddedToWishlist` — `getByText('Added to wishlist')` — MED (pin 6)
- `readonly textHeaderWishlistCount` — `locator('.header-wishlist-count')` — LOW (pin 3)
- `readonly linkHeaderWishlist` — `getByRole('link', { name: /wishlist/i })` — MED (pin 7)
- `readonly byProductCard(n: number)` — `getByRole('article').nth(n)` with `.describe(...)` — LOW (pin 1)
- `async open(): Promise<void>` — `goto(this.url)` + `waitForPageLoad()`
- `async waitForPageLoad(): Promise<void>` — `expect(this.headingProducts).toBeVisible()`
- `async clickAddToWishlistForCard(index: number): Promise<void>` — clicks `byProductCard(index).getByRole('button', { name: /add to wishlist/i })` — still index-based; see Q6
- `async navigateToWishlist(): Promise<PageClassWishlist>` — creates `page.waitForResponse('**/api/wishlist')` promise BEFORE click, clicks `linkHeaderWishlist`, awaits response, instantiates and returns `new PageClassWishlist(this.page)` after `waitForPageLoad()`

### `PageClassWishlist` — proposed fields and methods

- `readonly url = '/wishlist'` (assumed — confirm with Q10)
- `readonly headingWishlist` — web-first guard in `waitForPageLoad()`
- `readonly arrayWishlistItems` — `locator('.wishlist-item')` — LOW (pin 4)
- `readonly buttonRemoveFromWishlist` — `getByRole('button', { name: /remove from wishlist/i })` — MED (pin 2)
- `readonly textEmptyMessage` — `getByText(/your wishlist is empty/i)` — LOW (pin 5)
- `readonly textHeaderWishlistCount` — `locator('.header-wishlist-count')` — LOW (pin 3)
- `async waitForPageLoad(): Promise<void>` — `expect(this.headingWishlist).toBeVisible()`
- `async removeFirstItem(): Promise<void>` — clicks `this.buttonRemoveFromWishlist.first()`

### `wishlist.api.ts` — proposed shape

```
addProductToWishlist(productId: string, authToken: string): Promise<void>
  → POST /api/wishlist (endpoint TBD — see Q7)
  → payload: { productId }
  → asserts 201 or 200 response

clearWishlist(authToken: string): Promise<void>
  → DELETE /api/wishlist (endpoint TBD — see Q7)
  → teardown helper for scenario 1.2
```

No code here — Stage 2 emits this. Endpoint shape is an open question.

---

## Open questions for reviewer

**Q1: What is the accessible name of the "Add to wishlist" button?**
Context: source uses CSS class `button.add-to-wishlist` (line 17). Could be text "Add to wishlist", an icon (♡) with `aria-label="Add to wishlist"`, or visually hidden text.
What I assumed: accessible name `/add to wishlist/i` (case-insensitive regex).
Impact if wrong: `getByRole('button', { name: /add to wishlist/i })` matches nothing → test fails at action step, not at assertion. See pin 2.

**Q2: What HTML element is used for individual wishlist items?**
Context: source uses `.wishlist-item` CSS class (lines 29, 44). Items could be `<li>` (role=listitem), `<article>` (role=article), or `<div>` (no role).
What I assumed: CSS class fallback `locator('.wishlist-item')` — no role assumption.
Impact if wrong: `toHaveCount(1)` works on any locator, but the upgrade to `getByRole('listitem')` requires `<li>`. See pin 4.

**Q3: What text does the empty wishlist message display?**
Context: source locates by CSS class `.empty-wishlist-message` only (line 48); text content is unknown.
What I assumed: text matches `/your wishlist is empty/i`.
Impact if wrong: `getByText(...)` matches nothing, assertion silently fails (no element visible → `toBeVisible()` correctly fails). CSS class fallback in pin 5.

**Q4: Does the header wishlist count badge have a `data-testid` or `aria-label`?**
Context: source uses `.header-wishlist-count` CSS class only (lines 25, 49). Might be `data-testid="header-wishlist-count"` or have an `aria-live` region.
What I assumed: CSS class fallback; if testid exists, upgrade to `getByTestId('header-wishlist-count')`.
Impact if wrong: CSS class fallback works but is fragile across redesigns. See pin 3.

**Q5: What is the accessible name of the header wishlist link?**
Context: source uses `a.header-wishlist-link` (line 26). Could have text "Wishlist", "My Wishlist", or be icon-only.
What I assumed: `/wishlist/i` regex matches the accessible name.
Impact if wrong: `getByRole('link', { name: /wishlist/i })` matches nothing → navigation step fails. See pin 7.

**Q6: Can product cards be identified by name rather than index?**
Context: source uses `.eq(0)` and `.eq(2)` to select product cards (lines 16, 33). The test does not reference product names.
What I assumed: index-based selection with `getByRole('article').first()` / `.nth(2)` and a `// TODO` comment.
Impact if wrong: adding a product card before index 0/2 (e.g., promotional banner, out-of-stock card) shifts targets silently. Recommend `data-testid="product-card"` per product or filtering by product title.

**Q7: What is the API endpoint for adding/removing a product from the wishlist?**
Context: source only intercepts `GET /api/wishlist`; the write endpoint for the add action is not visible in the source. Scenario 1.2 setup requires adding via API rather than UI.
What I assumed: `POST /api/wishlist` with `{ productId }` payload; `DELETE /api/wishlist` for teardown.
Impact if wrong: `wishlist.api.ts` wrapper uses the wrong endpoint → test 1.2 setup fails at fixture stage. Must be confirmed before Stage 2.

**Q8: Should the `/api/wishlist` GET response be mocked (stubbed) or left as a real network call?**
Context: source uses `cy.intercept` purely for synchronization (no stub body). The test is currently E2E.
What I assumed: keep as real network call; use `page.waitForResponse('**/api/wishlist')` for synchronization only. No stub introduced.
Impact if wrong: if a mock is added, the displayed wishlist count becomes deterministic but may hide real backend bugs. If kept real, the test requires a live backend with the right seeded data.

**Q9: What is the accessible name of the "Remove from wishlist" button?**
Context: source uses `button.remove-from-wishlist` CSS class (line 44). Could be text "Remove", "Remove from wishlist", or an icon with aria-label.
What I assumed: `/remove from wishlist/i` regex.
Impact if wrong: `getByRole('button', { name: /remove from wishlist/i })` matches nothing → removal step fails. See pin 2.

**Q10: What is the URL of the wishlist page?**
Context: source navigates via link click; the wishlist URL is not in the source. I assumed `/wishlist`.
What I assumed: `url = '/wishlist'` on `PageClassWishlist`.
Impact if wrong: if the page URL is `/account/wishlist` or `/favorites`, the `PageClassWishlist.url` field and any direct `goto()` calls would be wrong.

**Q11: What ARIA role does the "Added to wishlist" toast notification have?**
Context: `cy.contains('Added to wishlist').should('be.visible')` (line 23). Toast elements vary: `role="status"`, `role="alert"`, or no role.
What I assumed: `page.getByText('Added to wishlist')` — text match, no role assumption.
Impact if wrong: If the toast has `role="alert"` or `role="status"`, upgrading to `getByRole('alert').filter({ hasText: 'Added to wishlist' })` is more resilient. Current `getByText` is correct regardless, just a missed upgrade opportunity. See pin 6.

**Q12: Does the products page or wishlist page require authentication?**
Context: the source test has no auth setup (`cy.session`, `cy.request` login, etc.). Products listing is often public; wishlist is usually user-specific.
What I assumed: test runs without authentication — products page is public; wishlist operations either work without auth (guest wishlist via localStorage) or the test environment has a pre-authed state.
Impact if wrong: if wishlist requires a logged-in session, the migrated test needs an `authenticated.fixture.ts` extending `base.fixture.ts` and a `helper/api/accounts.api.ts` user creator. This would significantly change the structural plan.

---

## Risk callouts

- **Real backend dependency.** Both scenarios depend on a live backend: the products grid must contain items, the `/api/wishlist` endpoint must be reachable, and the product at index 0 / index 2 must be a real product that supports wishlisting. The migrated test inherits this dependency. A backend outage or an empty products catalogue silently turns failures into "wrong element" errors rather than clear assertion failures. Mitigation: add a `beforeAll` health-check or use `helper/api/wishlist.api.ts` to seed the test product by ID.

- **Index-based product card selection.** `getByRole('article').first()` (scenario 1.1) and `.nth(2)` (scenario 1.2 setup, now API-replaced) couple the test to the DOM order of the product grid. Promotional cards, pagination, or out-of-stock badges inserted before position 0 or 2 silently target a different product. Mitigation: request `data-testid="product-card"` per card keyed to product ID, or filter by product name once Q6 is resolved.

- **`cy.wait(2000)` after network alias.** The double wait (`cy.wait('@wishlistLoad')` + `cy.wait(2000)`) suggests post-API-response rendering is slow or the test author was uncertain. Replacing with `wishlistPage.waitForPageLoad()` (web-first heading assertion) surfaces the real latency. If the wishlist page heading takes >5 s on CI (the default `actionTimeout`), the test will fail — this is a REAL CI bug to fix, not a flake to mask.

- **Scenario 1.2 shared state with scenario 1.1.** If scenario 1.1 successfully adds a product and does not remove it, scenario 1.2 may see a wishlist with 2 items, not 1. Playwright creates a fresh `BrowserContext` per test, so cookies and localStorage reset. However, if the wishlist is server-side (backed by a user ID), state persists across tests. Mitigation: use separate test users per scenario (via `accounts.api.ts`) or explicitly clear the wishlist via API in `afterEach`.

- **Scenario 1.2 UI add → API add restructuring.** The migration proposes replacing the UI add step in scenario 1.2 with an API call (`wishlist.api.ts`). If the wishlist write endpoint is not available in the test environment, this fallback to UI-add may be needed temporarily. The plan assumes the API is available; see Q7.

- **`cy.contains('Added to wishlist')` auto-dismissed toast.** Cypress's implicit retry keeps the element alive for assertion; Playwright `getByText('Added to wishlist').toBeVisible()` will fail if the toast auto-dismisses before the assertion retries catch it. A short `toBeVisible({ timeout: 3000 })` may be needed. Flag to CI team if the first run shows timing mismatches.

---

## Expected metrics

- **Selector quality score (estimated post-migration):** 4/9 ≈ 0.44 without testid additions (add-to-wishlist button, toast text, header link, remove button are role/text-based; 5 locators remain CSS/index). Rises to ≥0.78 if FE team adds `data-testid` for count badge, wishlist items, and product cards per Q4, Q2, Q6.
- **Smell count delta:** −21 (6 hard waits removed, 1 viewport moved to config, 1 conditional-logic block removed, 1 `cy.wait(@alias)` timeout-corrected, 2 index selectors noted with TODO, 10 CSS-class selectors replaced or noted for replacement)
- **Source LOC:** 51
- **Estimated target LOC:** ~210 across all files (spec ~80 LOC, products.page.ts ~70 LOC, wishlist.page.ts ~50 LOC, wishlist.api.ts ~30 LOC, labels.ts delta ~5 LOC); net LOC delta: +159
- **Anti-pattern coverage:** 21/21 (all cataloged smells addressed in the locator table, structural changes, or open questions)
