# Migration plan: missing-await.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes anti-patterns (missing awaits, hard waits, `page.pause()`, CSS-class selectors, a sync-probe assertion, hardcoded absolute URLs, a wrong import, and a magic price string) without adding new framework imports beyond fixture rewiring.

**Source file:** `inputs/bad-playwright/missing-await.spec.ts`
**Target file(s):**
- `outputs/tests/missing-await.spec.ts`
- `outputs/helper/page-object/pages/cart.page.ts`
- `outputs/helper/fixtures/base.fixture.ts` (mutate)
- `outputs/helper/test-data/labels.ts` (mutate)

## Summary

The Acme Shop cart suite exercises two behaviours on the `/cart` page: adding two products and verifying the subtotal reflects their combined price, and adding one product, setting its quantity to zero, clicking "Update", and verifying the cart empty-state message appears. Both scenarios are self-contained — each test navigates fresh to `/cart` and manages its own state through the UI.

The source is 30 LOC with fifteen catalogued smells: one wrong import (`@playwright/test` in a spec), five unawaited Playwright actions that silently discard their promises and race subsequent steps, four `waitForTimeout` calls (800 ms × 3, 1500 ms × 1) that mask those races, a `page.pause()` that would block CI indefinitely, a sync-probe `innerText()` assertion that snapshots instead of polling, two CSS-class-only locators with no accessible-name evidence, two hardcoded absolute URLs, and a magic price string `'$148'`.

### What bug does this catch?

Catches a regression where adding two specific products to the Acme Shop cart fails to update the displayed subtotal correctly, or where clearing an item's quantity to zero fails to surface the empty-cart message.

### User-perceivable assertion checklist

- [ ] After clicking "Add Linen Tee" and "Add Denim Jacket": cart subtotal element shows `$148`
- [ ] After clicking "Add Wool Beanie", setting quantity to `0`, clicking "Update": the text `"Your cart is empty"` is visible

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 1 | KB-1.1.26 | spec imports `test`/`expect` from `@playwright/test` | `import { test, expect } from '@playwright/test'` | `import { test, expect } from '@fixtures/base.fixture'` |
| H | 6 | KB-1.1.14 | hardcoded absolute URL | `page.goto('https://shop.acme.test/cart')` | Relative path `/cart`; set `baseURL` in `playwright.config.ts` |
| H | 7 | KB-1.1.7 | `page.pause()` left in committed code | `await page.pause()` | Remove entirely — blocks CI inspector wait indefinitely |
| H | 9 | KB-1.1.6 | missing `await` on action | `page.getByRole('button',{name:'Add Linen Tee'}).click()` | Prefix with `await`; moved into `cartPage.clickAddItem(...)` |
| H | 10 | KB-1.1.25 | short hard wait (800 ms) | `await page.waitForTimeout(800)` | Remove; replace with web-first assertion on cart state |
| H | 11 | KB-1.1.6 | missing `await` on action | `page.getByRole('button',{name:'Add Denim Jacket'}).click()` | Prefix with `await` |
| H | 12 | KB-1.1.25 | short hard wait (800 ms) | `await page.waitForTimeout(800)` | Remove; web-first assertion on subtotal element suffices |
| H | 15 | KB-1.1.19 | `innerText()` sync probe — no auto-retry | `expect(await subtotal.innerText()).toBe('$148')` | `await expect(cartPage.textSubtotal).toHaveText(EXPECTED_SUBTOTAL)` |
| H | 19 | KB-1.1.14 | hardcoded absolute URL (second test) | `page.goto('https://shop.acme.test/cart')` | Relative path `/cart` via `cartPage.open()` |
| H | 21 | KB-1.1.6 | missing `await` on action | `page.getByRole('button',{name:'Add Wool Beanie'}).click()` | Prefix with `await`; moved into `cartPage.clickAddItem(...)` |
| H | 22 | KB-1.1.25 | short hard wait (800 ms) | `await page.waitForTimeout(800)` | Remove; web-first assertion on qty-input or subtotal suffices |
| H | 24 | KB-1.1.6 | missing `await` on `page.fill` | `page.fill('.qty-input', '0')` | `await cartPage.fillQuantity('0')` |
| H | 25 | KB-1.1.6 | missing `await` on action | `page.getByRole('button',{name:'Update'}).click()` | `await cartPage.clickUpdate()` |
| H | 26 | KB-1.1.1 | hard wait (1500 ms) | `await page.waitForTimeout(1500)` | Remove; `await expect(cartPage.textEmptyCart).toBeVisible()` |
| M | 14 | KB-1.1.3 | CSS-class as primary selector | `page.locator('.cart-subtotal')` | `getByTestId('cart-subtotal')` pending Q1 — LOW confidence; see pins |
| M | 24 | KB-1.1.3 | CSS-class as primary selector | `page.fill('.qty-input', '0')` | `getByLabel(/quantity/i)` pending Q2 — LOW confidence; see pins |
| L | 15 | KB-1.1.9 | magic string (expected price) | `'$148'` | `const EXPECTED_SUBTOTAL = '$148'` at top of spec |

## Locator translation table

Only upgrade rows are shown. Locators already on the canonical hierarchy — `getByRole('button', { name: '...' })` for all four add/update buttons (lines 9, 11, 21, 25) and `getByText('Your cart is empty')` (line 28) — are not enumerated; only the missing `await` prefixes need fixing (catalogued above).

DOM snapshot absent (no file at `outputs/dom-snapshots/missing-await.spec.ts.yaml`). Locator confidence is inferred from source evidence only; validator exits 0 when no snapshot is present.

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('.cart-subtotal')` | `page.getByTestId('cart-subtotal')` | low | CSS class only; no testid or ARIA evidence. Fallback: keep `locator('.cart-subtotal')` + WHY-comment `'Q1 unresolved'`. See pin 1. |
| `page.fill('.qty-input', '0')` | `page.getByLabel(/quantity/i)` | low | CSS class only; qty-input accessible label unknown. Fallback: keep `locator('.qty-input')` + WHY-comment `'Q2 unresolved'`. See pin 2. |
| `page.getByText('Your cart is empty')` | `page.getByText(/your cart is empty/i)` | high | Already canonical `getByText`; upgrade exact string to case-insensitive regex for copy-change resilience. No DOM evidence for role promotion. |

## Hallucination-defense pins

1. **Cart subtotal element** — assumed `page.getByTestId('cart-subtotal')`. If DOM lacks a `data-testid` attribute: keep `page.locator('.cart-subtotal')`, add WHY-comment `'Q1 unresolved: cart-subtotal testid not confirmed — CSS class fallback'`. Reviewer fallback: ask FE team to add `data-testid="cart-subtotal"`. If the element already carries an ARIA role (e.g. `role="status"` or `role="region"`), switch to `getByRole(role, { name: /subtotal/i })` instead.

2. **Quantity input** — assumed `page.getByLabel(/quantity/i)`. If no `<label>` or `aria-label` exists for the input: keep `page.locator('.qty-input')` (with `await` restored), add WHY-comment `'Q2 unresolved: qty-input accessible label not confirmed — CSS class fallback'`. Reviewer fallback: ask FE to add `aria-label="Quantity"` or a visible `<label>`; if element type is `number` (spinbutton), `page.getByRole('spinbutton')` is a valid intermediate upgrade until a real label ships.

## Structural changes

Single-file input. No source files are DROPPED. The input spec is RESHAPED into the qa-master layered output. This is a subtractive migration — no new framework imports are added beyond the fixture rewiring.

- **Extract POM:** yes — `PageClassCart` at `outputs/helper/page-object/pages/cart.page.ts`. Mandated by qa-master architecture (migration-rules.md §5a: "Always at least one — every page the test visits gets a `PageClass<Name>`"). The two CSS-class locators that need upgrading, the repeated `page.goto` + page-load wait pattern, and the five action methods additionally justify extraction. Class has no own constructor; `readonly` locator fields with `.describe('[Cart] …')`.
- **Extract fixture:** yes — `outputs/helper/fixtures/base.fixture.ts` (mutate); add `cartPage: PageClassCart` as an injectable fixture. Spec receives `{ cartPage }` from the fixture; no `new PageClassCart(page)` in the spec body.
- **Split into multiple specs:** no — both scenarios target the same cart page and share the same page object.
- **New test-data:** `outputs/helper/test-data/labels.ts` (mutate); add `LABEL_CART = "Cart"`. The spec also defines inline file-scoped constants: `EXPECTED_SUBTOTAL`, `PRODUCT_LINEN_TEE`, `PRODUCT_DENIM_JACKET`, `PRODUCT_WOOL_BEANIE`.

### PageClassCart design

`PageClassCart extends BasePage`:

- `readonly url = '/cart'` — relative path; `baseURL` from `playwright.config.ts`.
- `readonly byAddItemButton = (name: string) =>` `this.page.getByRole('button', { name }).describe(`[${LABEL_CART}] Add item: ${name}`)` — parameterised lazy locator for product-specific add buttons.
- `readonly buttonUpdate` — `this.page.getByRole('button', { name: 'Update' }).describe(...)`.
- `readonly textSubtotal` — per pin 1: `getByTestId('cart-subtotal')` if testid confirmed; else `locator('.cart-subtotal')` with WHY-comment.
- `readonly inputQuantity` — per pin 2: `getByLabel(/quantity/i)` if label confirmed; else `locator('.qty-input')` with WHY-comment.
- `readonly textEmptyCart` — `this.page.getByText(/your cart is empty/i).describe(...)`.
- `async open(): Promise<void>` — `await this.page.goto(this.url); await this.waitForPageLoad()`.
- `async waitForPageLoad(): Promise<void>` — web-first guard; see Q3.
- `async clickAddItem(name: string): Promise<void>` — `await this.byAddItemButton(name).click()`.
- `async fillQuantity(value: string): Promise<void>` — `await this.inputQuantity.fill(value)`.
- `async clickUpdate(): Promise<void>` — `await this.buttonUpdate.click()`.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/cart.page.ts` | Exposes `byAddItemButton`, `textSubtotal`, `inputQuantity`, `buttonUpdate`, `textEmptyCart`; `[LABEL]` describes; qa-master §5a mandates ≥1 PageClass per visited page |
| Block | (none) | 5 locators, single cart section, no reuse across pages — threshold not met |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add `cartPage: PageClassCart` injection; spec must never call `new PageClassCart(page)` |
| API | (none) | Tests drive the UI add-item flow themselves; no backend data-prep needed |
| Action | (none) | Single-page journey |
| Utility | (none) | No price string parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | Add `LABEL_CART = "Cart"` |
| Type | (none) | No new API response shapes or internal value objects |
| Spec | `outputs/tests/missing-await.spec.ts` | The test |

## Open questions for reviewer

Q1: What is the accessible role or `data-testid` attribute on the `.cart-subtotal` element? Is it a `<p>`, `<span>`, `<div role="status">`, or an element with `data-testid="cart-subtotal"`?
Context: Line 14 `const subtotal = page.locator('.cart-subtotal')` — CSS class only.
What I assumed (proceeding without an answer): `getByTestId('cart-subtotal')` as the upgrade target; fallback to `locator('.cart-subtotal')` with WHY-comment.
Impact if my assumption is wrong: `getByTestId` finds nothing → test error; CSS fallback is functionally equivalent to the original but stays fragile against styling refactors.

Q2: What is the accessible label of the quantity input (`.qty-input`)? Is there a `<label>`, `aria-label`, or `aria-labelledby`? Is the input type `number` (which would make `getByRole('spinbutton')` valid)?
Context: Line 24 `page.fill('.qty-input', '0')` — CSS class only.
What I assumed: `getByLabel(/quantity/i)` as the upgrade; fallback to `locator('.qty-input')`.
Impact if my assumption is wrong: `getByLabel` matches nothing → `fillQuantity('0')` fails on element-not-found.

Q3: Does the cart page expose a stable heading or landmark that `waitForPageLoad()` on `PageClassCart` can use as its readiness guard?
Context: `PageClassCart.waitForPageLoad()` needs a web-first assertion on a reliably-present element. Without a DOM snapshot there is no heading or testid to pin it to.
What I assumed: `await expect(this.page).toHaveURL(/\/cart/)` as a provisional guard. This is weak (URL may match before content renders).
Impact if my assumption is wrong: `waitForPageLoad()` resolves before cart content renders → subsequent locator assertions race the DOM, producing intermittent element-not-found failures.

Q4: Is the subtotal string exactly `'$148'` (dollar sign prefix, no decimal places, no spaces)? Or could the app format it as `'$148.00'`, `'$ 148'`, or `'148.00 USD'`?
Context: Line 15 `expect(await subtotal.innerText()).toBe('$148')` — exact string match.
What I assumed: `toHaveText('$148')` preserves the original exact match. Stage 2 may also emit `toHaveText(/\$148/)` for copy-change resilience.
Impact if my assumption is wrong: test fails on a numerically-correct subtotal that is formatted differently → false negative.

Q5: Are product names `'Add Linen Tee'`, `'Add Denim Jacket'`, `'Add Wool Beanie'` stable accessible button names in the DOM, or are they generated from a product catalogue that may vary?
Context: Lines 9, 11, 21 — product names inline in `getByRole('button', { name: ... })` calls.
What I assumed: file-scoped named constants (`PRODUCT_LINEN_TEE = 'Add Linen Tee'`, etc.) in the spec are sufficient for now.
Impact if my assumption is wrong: if product names change in test environments, all three add-item steps fail on element-not-found without a product-regression signal.

Q6: What product prices compose the `$148` expected subtotal (e.g., Linen Tee $49 + Denim Jacket $99)?
Context: Line 15 `'$148'` is asserted as a magic string. If either price changes in the test environment the assertion fails with a price mismatch rather than a product-behaviour regression.
What I assumed: `$148` is stable in the target environment; extracted to `const EXPECTED_SUBTOTAL = '$148'` for easy update.
Impact if my assumption is wrong: spec fails on a non-regression pricing change — wasted investigation time.

## Risk callouts

- **Missing-`await` race (mitigated).** Five unawaited Playwright actions (lines 9, 11, 21, 24, 25) produce `UnhandledPromiseRejection` errors that can corrupt test state silently or cause succeeding actions to target the wrong DOM state. The `waitForTimeout` calls (lines 10, 12, 22, 26) happen to mask the races by draining the event loop. The migration fixes both together: every action is awaited AND all hard waits are replaced with web-first assertions. Removing waits without fixing the awaits would expose the races; the plan handles them in lockstep.

- **Hard-wait removal exposing real cart latency.** The 800 ms `waitForTimeout` calls (lines 10, 12, 22) may compensate for genuine async cart-update latency (e.g., a network call to a server-side cart endpoint). Replacing with `await expect(cartPage.textSubtotal).toHaveText(EXPECTED_SUBTOTAL)` is correct in principle — the web-first assertion polls until the expected value appears — but if the cart API is genuinely slow (>5 s `actionTimeout`), CI will now surface the real latency as a timeout failure. That is correct behaviour; Stage 2 must not silently raise `actionTimeout` as a workaround.

- **`page.pause()` blocks CI unconditionally.** Line 7 must be removed. It suspends the runner waiting for Playwright Inspector interaction that never arrives in headless CI — the job hangs until a runner timeout kills it. This is a hard blocker, not a flake.

- **Sync-probe flake (mitigated).** `expect(await subtotal.innerText()).toBe('$148')` (line 15) snapshots the DOM at one instant. If the subtotal updates asynchronously after the second "Add" click, the snapshot may capture the pre-update value (`'$0'` or `'$49'`) and fail transiently. `await expect(cartPage.textSubtotal).toHaveText(EXPECTED_SUBTOTAL)` polls until the expected value appears — this is the correct and complete fix.

- **Exact subtotal string.** `'$148'` is derived from two product prices and will fail on any price change that is not a product regression. Locale-specific formatting (decimal points, currency-symbol position, thousands separators) can also produce false negatives. Extracting to `EXPECTED_SUBTOTAL` makes the constant easy to update; prefer `toHaveText(/\$148/)` unless the exact formatter is known to be stable.

- **Empty-cart text match breadth.** `getByText(/your cart is empty/i)` matches that substring anywhere in the DOM, including hidden elements or server-rendered comments. If the empty-state message has surrounding text ("Your cart is empty. Start shopping."), `toBeVisible()` still passes. Acceptable for a first migration but could be tightened with `getByRole('status')` or a testid-scoped locator if false positives occur.

## Expected metrics

- **Selector quality score (estimated):** 0.71 — 5/7 target locators are role/label/text-based (`byAddItemButton` × 3 via `getByRole` HIGH, `buttonUpdate` via `getByRole` HIGH, `textEmptyCart` via `getByText` HIGH); 2 locators (`textSubtotal`, `inputQuantity`) remain LOW-confidence pending Q1/Q2. Improves to 1.0 if both CSS upgrades succeed.
- **Smell count delta:** −15 smells removed, +0 introduced (1 wrong import, 2 hardcoded URLs, 1 page.pause, 5 missing awaits, 4 waitForTimeout calls, 1 sync-probe assertion, 2 CSS-class selectors, 1 magic string; 2 CSS locator upgrades are pending reviewer confirmation of Q1/Q2).
- **LOC delta:** source ~30 LOC → spec ~35 LOC + POM ~50 LOC + fixture delta ~5 LOC + test-data delta ~3 LOC ≈ **+63 LOC net** (POM extraction is the driver; raw LOC increases but structure and maintainability improve).
- **Anti-pattern coverage:** 15/15 catalogued occurrences across 9 distinct KB categories (KB-1.1.26, KB-1.1.14 ×2, KB-1.1.7, KB-1.1.6 ×5, KB-1.1.25 ×3, KB-1.1.1, KB-1.1.19, KB-1.1.3 ×2, KB-1.1.9).
