# Migration plan: missing-await.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes anti-patterns (missing awaits, hard waits, `page.pause()`, CSS-class selectors, a sync-probe assertion, hardcoded absolute URLs, and a magic price string) without adding new framework imports beyond fixture rewiring.

**Source file:** `inputs/bad-playwright/missing-await.spec.ts`
**Target file(s):**
- `outputs/tests/cart-subtotal.spec.ts`
- `outputs/helper/page-object/pages/cart.page.ts`
- `outputs/helper/fixtures/base.fixture.ts` (mutate)
- `outputs/helper/test-data/labels.ts` (mutate)

## Summary

The Acme Shop cart suite exercises two behaviours on the `/cart` page: adding two products and verifying the subtotal reflects their combined price, and setting an item's quantity to zero then clicking "Update" to clear the cart. The source is already Playwright TypeScript but carries fourteen catalogued smells: five unawaited Playwright actions that silently discard their promises, three `waitForTimeout` calls (800 ms × 2, 1500 ms × 1) that race the UI, a `page.pause()` that blocks CI indefinitely, a sync-probe `innerText()` assertion that snapshots instead of polling, two CSS-class-only locators with no accessible-name evidence, two hardcoded absolute URLs, and a magic price string `'$148'`.

### What bug does this catch?

Catches a regression where adding two specific products to the Acme Shop cart fails to update the displayed subtotal correctly, or where clearing an item's quantity to zero fails to surface the empty-cart message.

### User-perceivable assertion checklist

- [ ] After clicking "Add Linen Tee" and "Add Denim Jacket": cart subtotal element shows `$148`
- [ ] After setting item quantity to `0` and clicking "Update": the text "Your cart is empty" is visible

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 7 | KB-1.1.7 | page.pause leftover | `await page.pause()` | Remove entirely — blocks CI inspector wait indefinitely |
| H | 6 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/cart')` | Relative path `/cart`; set `baseURL` in `playwright.config.ts` |
| H | 9 | KB-1.1.6 | missing-await | `page.getByRole('button',{name:'Add Linen Tee'}).click()` | Prefix with `await`; unawaited promise races the next line |
| H | 10 | KB-1.1.25 | short-hard-wait | `await page.waitForTimeout(800)` | Remove; replace with web-first assertion on cart state |
| H | 11 | KB-1.1.6 | missing-await | `page.getByRole('button',{name:'Add Denim Jacket'}).click()` | Prefix with `await` |
| H | 12 | KB-1.1.25 | short-hard-wait | `await page.waitForTimeout(800)` | Remove; web-first assertion on subtotal element suffices |
| H | 15 | KB-1.1.19 | sync-probe | `expect(await subtotal.innerText()).toBe('$148')` | `await expect(cartPage.textSubtotal).toHaveText('$148')` |
| H | 19 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/cart')` | Relative path `/cart` (second test) |
| H | 21 | KB-1.1.6 | missing-await | `page.fill('.qty-input', '0')` | `await cartPage.inputQty.fill('0')` |
| H | 22 | KB-1.1.6 | missing-await | `page.getByRole('button',{name:'Update'}).click()` | `await cartPage.buttonUpdate.click()` |
| H | 23 | KB-1.1.1 | hard-wait | `await page.waitForTimeout(1500)` | Remove; `await expect(cartPage.textEmptyCart).toBeVisible()` |
| M | 14 | KB-1.1.3 | css-class | `page.locator('.cart-subtotal')` | Role/testid upgrade TBD — LOW confidence (see pins) |
| M | 21 | KB-1.1.3 | css-class | `page.fill('.qty-input', '0')` | `getByLabel(/quantity/i)` — LOW confidence (see pins) |
| L | 15 | KB-1.1.9 | magic-string | `'$148'` | `const EXPECTED_SUBTOTAL = '$148'` at top of spec |

### Unclassified smells

**Line 1 — `import { test, expect } from '@playwright/test'` in a spec file.** The qa-master conformance rule (migration-rules.md §2) forbids importing `test`/`expect` from `@playwright/test` directly in a spec. Only `outputs/helper/fixtures/base.fixture.ts` carries that import; specs must use `@fixtures/base.fixture`. Stage 2 rewires this import as a structural step. No KB entry exists for this constraint; it is a pipeline-level conformance rule, not a framework anti-pattern.
**Reviewer note:** This is not a judgement call — Stage 2 must perform this rewiring unconditionally.

## Locator translation table

Only locators that need an upgrade are listed. The four `getByRole` calls in the source (`'Add Linen Tee'`, `'Add Denim Jacket'`, `'Update'`) and the single `getByText` call are already on the canonical hierarchy and require no locator changes — only the missing `await` prefixes (catalogued above in anti-patterns).

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('.cart-subtotal')` | `page.getByTestId('cart-subtotal')` | low | CSS class only; no testid or ARIA evidence available. Fallback: keep `locator('.cart-subtotal')` + WHY-comment. See pin 1. |
| `page.fill('.qty-input', '0')` | `page.getByLabel(/quantity/i)` | low | CSS class only; label text of qty input unknown. Fallback: keep `locator('.qty-input')` + WHY-comment. See pin 2. |
| `page.getByText('Your cart is empty')` | `page.getByText(/your cart is empty/i)` | high | Already canonical `getByText`; upgrade exact string to regex for copy-change resilience. No role evidence available for `getByRole` promotion. |

## Hallucination-defense pins

1. **Cart subtotal element** — assumed `page.getByTestId('cart-subtotal')`. If DOM lacks a `data-testid` attribute: keep `page.locator('.cart-subtotal')`, add WHY-comment `'Q1 unresolved: cart-subtotal testid not confirmed'`. Reviewer fallback: ask FE team to add `data-testid="cart-subtotal"`, OR if element carries an ARIA role (e.g. `role="status"` or `role="region"`), switch to `getByRole(role, { name: /subtotal/i })` instead.

2. **Quantity input** — assumed `page.getByLabel(/quantity/i)`. If no `<label>` or `aria-label` exists for the input: keep `page.locator('.qty-input')`, add WHY-comment `'Q2 unresolved: qty-input accessible label not confirmed'`. Reviewer fallback: confirm label text in the DOM, ask FE to add `aria-label="Quantity"`, or if element type is `number`/`spinbutton`, use `page.getByRole('spinbutton')` as an intermediate step pending a real label.

## Structural changes

- **Extract POM:** yes — `PageClassCart` at `outputs/helper/page-object/pages/cart.page.ts`. Mandated by qa-master architecture (migration-rules.md §1 and §5a: "Always at least one — every page the test visits gets a `PageClass<Name>`"). The two CSS-class locators that need upgrading and the `open()` + `waitForPageLoad()` pattern additionally justify extraction. Class has no own constructor; locator fields are `readonly` with `.describe('[Cart] …')`.
- **Extract fixture:** yes — `outputs/helper/fixtures/base.fixture.ts` (mutate); add `cartPage: PageClassCart` as an injectable fixture. Spec receives `{ cartPage }` from the fixture; no `new PageClassCart(page)` in the spec body.
- **Split into multiple specs:** no — both scenarios target the same cart page and share the same page object. Two tests in one `test.describe` is well within the limit.
- **New test-data:** yes — `outputs/helper/test-data/labels.ts` (mutate); add `LABEL_CART = "Cart"`. The spec also defines inline file-scoped constants: `EXPECTED_SUBTOTAL`, `PRODUCT_LINEN_TEE`, `PRODUCT_DENIM_JACKET`.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/cart.page.ts` | Exposes `byAddButton`, `textSubtotal`, `inputQty`, `buttonUpdate`, `textEmptyCart` with `[LABEL]` describes; qa-master §1 mandates at least one PageClass per visited page |
| Block | (none) | 5 locators, single cart section, no reuse across pages |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add `cartPage: PageClassCart` injection; spec must never call `new PageClassCart(page)` |
| API | (none) | Tests drive the UI directly; no backend data-prep needed for scenario 1.1 — see Q5 for scenario 1.2 |
| Action | (none) | Single-page journey |
| Utility | (none) | No price string parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | Add `LABEL_CART = "Cart"` |
| Type | (none) | No new API response shapes or internal value objects |
| Spec | `outputs/tests/cart-subtotal.spec.ts` | The test |

## Open questions for reviewer

Q1: What is the accessible role or `data-testid` attribute on the `.cart-subtotal` element? Is it a `<p>`, `<span>`, `<div role="status">`, or an element with `data-testid="cart-subtotal"`?
Context: Line 14 `const subtotal = page.locator('.cart-subtotal')` — CSS class only.
What I assumed (if proceeding without an answer): `getByTestId('cart-subtotal')` as the upgrade target; fallback to `locator('.cart-subtotal')` with WHY-comment `'Q1 unresolved'`.
Impact if my assumption is wrong: `getByTestId` finds nothing → test error; CSS fallback is functionally equivalent to the original but stays fragile against styling refactors.

Q2: What is the accessible label of the quantity input (`.qty-input`)? Is there a `<label>`, `aria-label`, or `aria-labelledby`? Is the input type `number` (which would make `getByRole('spinbutton')` valid)?
Context: Line 21 `page.fill('.qty-input', '0')` — CSS class only.
What I assumed: `getByLabel(/quantity/i)` as the upgrade; fallback to `locator('.qty-input')`.
Impact if my assumption is wrong: `getByLabel` matches nothing → test error on the fill step; CSS fallback preserves original behaviour.

Q3: Does the cart page expose a stable heading or landmark (`<h1>Shopping Cart`, `[data-testid="cart-heading"]`, etc.) that `waitForPageLoad()` on `PageClassCart` can use as its readiness guard?
Context: `PageClassCart.waitForPageLoad()` needs a web-first assertion on a reliably-present element.
What I assumed: `await expect(this.textEmptyCart, '[Cart] Empty-cart text OR subtotal should be visible after navigation').toBeVisible()` as a conditional guard — but this is fragile because the right element depends on cart state.
Impact if my assumption is wrong: `waitForPageLoad()` assertion targets the wrong element and the first test that navigates to a populated cart may fail the guard.

Q4: Is the expected subtotal string exactly `'$148'` (no decimal places, dollar sign prefix, no spaces)? Or could the app format it as `'$148.00'`, `'$ 148'`, or `'148.00 USD'`?
Context: Line 15 `expect(await subtotal.innerText()).toBe('$148')` — exact string assertion.
What I assumed: `toHaveText('$148')` preserves the original exact match; Stage 2 may also emit `toHaveText(/\$148/)` for resilience. The reviewer should confirm the format.
Impact if my assumption is wrong: test fails on a correctly-computed subtotal that displays with different formatting → false negative.

Q5: **Critical — test-order coupling.** Test 2 ("removing the last item clears the cart subtotal") navigates fresh to `/cart` but never adds any item. In Playwright's default `fullyParallel: true` mode, each test starts with a fresh browser context — no cart state survives from Test 1. An empty-cart page likely renders no quantity input, so `page.fill('.qty-input', '0')` would fail immediately. Does the app seed cart state from a cookie or localStorage that persists across context boundaries? Or is this test implicitly coupled to Test 1 having run first (KB-1.1.11)?
Context: Lines 19–28 — no `beforeEach` or `page.goto` adds an item before the fill.
What I assumed: This is an implicit test-order coupling bug. In the migrated version, Test 2 must either add its own item first (via `cartPage.addItem(...)`) or seed cart state via an API fixture before `open()`.
Impact if my assumption is wrong: if the cart IS seeded by a real session fixture external to the test, the migration strategy differs significantly and `requiredApi` would need a `cart.api.ts` wrapper.

Q6: Are product names `'Add Linen Tee'` and `'Add Denim Jacket'` stable accessible button names in the DOM, or are they generated from a product catalog that may vary? If the same product names appear in other test files, they should move to `outputs/helper/test-data/`.
Context: Lines 9, 11 — product names inline.
What I assumed: file-scoped named constants (`const PRODUCT_LINEN_TEE = 'Add Linen Tee'`) in the spec are sufficient.
Impact if my assumption is wrong: low — stylistic only, but product names shared across spec files would create a maintenance burden.

## Risk callouts

- **Test-order coupling — likely CI breakage.** Test 2 navigates to `/cart` in a fresh browser context with no items seeded. In `fullyParallel: true` mode, the qty input will not exist on the page, and the migrated `inputQty.fill('0')` call will time-out on `actionTimeout: 5_000`. This is the highest-priority issue; it must be resolved before the migration reaches Stage 2. See Q5.

- **Hard-wait masking async add-item latency.** The 800 ms `waitForTimeout` calls (lines 10, 12) may compensate for a real async update after clicking "Add" (e.g. a cart-count badge rerendering or a network call to update server-side cart state). Replacing them with `await expect(cartPage.textSubtotal).toHaveText(EXPECTED_SUBTOTAL)` is correct in principle, but if the subtotal update is backend-driven and slow, the web-first assertion will expose real latency that the hard-wait was papering over. Stage 2 must not silently raise `actionTimeout` as a workaround — if it is genuinely slow, raise a flag.

- **Exact subtotal string.** `'$148'` is asserted as an exact match. Locale-specific formatting (decimal points, currency symbol position, thousands separators) can cause the assertion to fail on a numerically correct subtotal. Prefer `toHaveText(/\$148/)` unless the formatter is known to be stable.

- **`page.pause()` blocks CI unconditionally.** Line 7 must be removed. It awaits Playwright Inspector interaction that never arrives in headless CI runs; the job hangs until a runner timeout kills it. This anti-pattern suggests the test was developed interactively and not cleaned before commit.

- **Sync-probe flake.** The `expect(await subtotal.innerText()).toBe('$148')` (line 15) snapshots the DOM at one instant. If the subtotal updates asynchronously after the second "Add" click, the snapshot may capture the pre-update value (`'$0'` or `'$49'`) and fail transiently. The web-first replacement `await expect(cartPage.textSubtotal).toHaveText(EXPECTED_SUBTOTAL)` polls until the expected value appears — this is the correct fix and also the only change needed to eliminate the flake.

## Expected metrics

- **Selector quality score (estimated):** 0.70 (5 target locators total: `byAddButton` ×2 HIGH, `buttonUpdate` HIGH, `textEmptyCart` HIGH, `textSubtotal` LOW pending Q1 → 4/5 = 0.80 if subtotal resolved; `inputQty` LOW pending Q2 brings it to 4/6 = 0.67 if both stay CSS. Target 0.70 is achievable if Q1 is resolved; Q2 resolution brings it to 1.0.)
- **Smell count delta:** −1 `page.pause()`, −2 hardcoded URLs, −4 missing awaits, −3 `waitForTimeout` calls, −1 sync-probe assertion, −2 CSS-class selectors, −1 magic string = **−14 smells removed, +0 introduced**.
- **LOC delta:** source ~30 LOC → spec ~32 LOC + POM ~45 LOC + fixture delta ~5 LOC + test-data delta ~3 LOC ≈ **+55 LOC** (POM extraction is the driver; raw LOC increases but structure improves maintainability).
- **Anti-pattern coverage:** 14/14 cataloged + 1 unclassified (qa-master import conformance).
