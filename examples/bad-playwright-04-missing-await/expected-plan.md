# Migration plan: input.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration adds missing `await` keywords, deletes a stray `page.pause()`, and replaces hard waits with web-first assertions.

**Source file:** `examples/bad-playwright-04-missing-await/input.spec.ts`
**Target file(s):** `examples/bad-playwright-04-missing-await/expected-output.spec.ts`

## Summary

Cart page on the Acme Shop. Two scenarios: adding two items with known prices renders the correct subtotal (`$148`), and zeroing the quantity on the last remaining item surfaces the empty-state copy. Existing spec leaks unawaited promises on every click and `fill`, then masks the resulting races with `waitForTimeout`. A leftover `page.pause()` would also block CI indefinitely if this spec ever ran in headed mode.

### What bug does this catch?

Catches a regression where (a) the cart subtotal arithmetic stops correctly summing line items (subtotal != $148 after adding Linen Tee + Denim Jacket), and (b) the cart's empty-state copy stops appearing when quantity drops to zero.

### User-perceivable assertion checklist

- [ ] After adding Linen Tee + Denim Jacket: cart subtotal element shows `"$148"`
- [ ] After zeroing the quantity on Wool Beanie and clicking Update: page shows `"Your cart is empty"`

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 8 | KB-1.1.7 | page-pause-leftover | `await page.pause()` | remove entirely — would block CI in headed mode |
| H | 10 | KB-1.1.6 | missing-await | `page.getByRole(...).click()` (no await) | `await page.getByRole(...).click()` |
| H | 12 | KB-1.1.6 | missing-await | `page.getByRole(...).click()` (no await) | `await page.getByRole(...).click()` |
| H | 22 | KB-1.1.6 | missing-await | `page.getByRole(...).click()` (no await) | `await page.getByRole(...).click()` |
| H | 25 | KB-1.1.6 | missing-await | `page.fill('.qty-input', '0')` (no await) | `await page.getByLabel(/quantity/i).fill('0')` |
| H | 26 | KB-1.1.6 | missing-await | `page.getByRole(...).click()` (no await) | `await page.getByRole(...).click()` |
| H | 11 | KB-1.1.1 | hard-wait | `page.waitForTimeout(800)` | remove — `click()` auto-waits; rely on next assertion |
| H | 13 | KB-1.1.1 | hard-wait | `page.waitForTimeout(800)` | remove |
| H | 23 | KB-1.1.1 | hard-wait | `page.waitForTimeout(800)` | remove |
| H | 27 | KB-1.1.1 | hard-wait | `page.waitForTimeout(1500)` | remove — rely on `toBeVisible()` polling |
| H | 16 | KB-1.1.5 | sync-probe | `expect(await subtotal.innerText()).toBe(...)` | `await expect(subtotal).toHaveText(...)` |
| H | 6 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/cart')` | configure `baseURL`; use `page.goto('/cart')` |
| H | 20 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/cart')` | use `page.goto('/cart')` |
| M | 15 | KB-1.1.3 | css-class | `page.locator('.cart-subtotal')` | `page.getByRole('status', { name: /subtotal/i })` (MED conf — see pins) |
| M | 25 | KB-1.1.3 | css-class | `page.fill('.qty-input', '0')` | `page.getByLabel(/quantity/i).fill('0')` (MED conf — see pins) |

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('.cart-subtotal')` | `page.getByRole('status', { name: /subtotal/i })` | med | Subtotals often expose `role="status"` for screen readers. Fall back to `getByTestId('cart-subtotal')` or `getByText(/subtotal/i)` if not. |
| `page.fill('.qty-input', ...)` | `page.getByLabel(/quantity/i).fill(...)` | med | Quantity inputs typically have an associated `<label>Quantity</label>` or `aria-label="Quantity"`. Fall back to `getByRole('spinbutton')` if the input is `type="number"`. |
| `page.getByRole('button', { name: 'Add Linen Tee' })` | unchanged | high | Already role+name based — preserve. |
| `page.getByRole('button', { name: 'Add Denim Jacket' })` | unchanged | high | Already role+name based — preserve. |
| `page.getByRole('button', { name: 'Add Wool Beanie' })` | unchanged | high | Already role+name based — preserve. |
| `page.getByText('Your cart is empty')` | `page.getByText(/your cart is empty/i)` | high | Case-insensitive regex makes the assertion resilient to copy tweaks. |

## Hallucination-defense pins

1. **Cart subtotal element** — assumed `getByRole('status', { name: /subtotal/i })`. If DOM lacks `role="status"` and no aria-label: keep `.cart-subtotal` CSS, add WHY-comment `'Q1 unresolved: subtotal a11y not confirmed'`. Reviewer fallback: ask FE team to add `role="status" aria-label="Subtotal"` OR `data-testid="cart-subtotal"`.
2. **Quantity input** — assumed `getByLabel(/quantity/i)`. If no `<label>` and no `aria-label`: try `getByRole('spinbutton')` (works for `type="number"`); failing that, keep `.qty-input` CSS, comment `'Q2: quantity input lacks label'`. Reviewer fallback: this is also an a11y bug — raise rather than hack around.

## Structural changes

- **Extract POM:** no — single short spec, two scenarios, fixture overhead would outweigh the savings. Reconsider if a third cart scenario lands.
- **Extract fixture:** no — `beforeEach` doesn't exist; both tests open `/cart` directly. Could add a `cartPage` fixture but premature with only 2 tests.
- **Split into multiple specs:** no — both scenarios target the same page and share intent (subtotal arithmetic).
- **Restore `await` discipline:** yes — every Playwright action gets its missing `await` back. The eval script (per migration-rules.md §8) treats unawaited promises as a hard fail.
- **Remove `page.pause()`:** yes — debug-only API, never belongs in committed code (per migration-rules.md §8 + KB-1.1.7).

## Open questions for reviewer

- Q1: Does `.cart-subtotal` expose `role="status"` and an `aria-label="Subtotal"`? If not, screen reader users get no announcement when the subtotal updates — that's an a11y bug.
- Q2: Is the quantity input labeled (either `<label for="qty">Quantity</label>` or `aria-label="Quantity"`)? If not, raise as a11y bug.
- Q3: Was the `page.pause()` on line 8 left over from someone debugging the original `waitForTimeout` races? Worth confirming it was never run on CI (if it was, that test was timing out, not flaking).
- Q4: Are `Linen Tee`, `Denim Jacket`, and `Wool Beanie` priced at $29, $119, $24 (matching the `02-nth-selectors` fixture)? If product prices change, the `$148` subtotal assertion needs updating.
- Q5: Does Update on quantity=0 immediately render the empty-state copy, or does the backend confirm asynchronously? If the latter, the assertion may need a longer timeout — but should still NOT use `waitForTimeout`.

## Risk callouts

- **Missing-await fixes are CORRECTNESS, not cosmetic.** The original code dispatched unawaited promises and then used `waitForTimeout(800)` to "give them a chance to finish". Removing the timeout WITHOUT adding `await` would surface real race conditions; adding `await` WITHOUT removing the timeout would slow CI for no reason. The migration does both in lockstep — reviewer should not split this commit.
- **`page.pause()` would have blocked CI.** If this spec ever ran under `--headed` on a CI machine without an inspector attached, it would hang until the per-test timeout fired. Worth asking why it survived previous reviews — likely never ran headed.
- **Subtotal value coupling.** Asserting `$148` hard-codes the sum of Linen Tee ($29) + Denim Jacket ($119). A price change in either product silently breaks the test with no product regression signal. Consider extracting product prices to a fixture and computing the expected subtotal at test time.
- **Subtotal currency formatting.** `$148` assumes US-locale formatting. If the app supports multi-currency, this test silently fails for any other locale. Consider regex `/\$?148(\.00)?/`.

## Expected metrics

- **Selector quality score (estimated):** 0.86 (6/7 role/label-based; 1 LOW pending pin resolution).
- **Smell count delta:** -1 `page.pause()`, -5 missing-await calls, -4 hard-waits, -1 sync probe, -2 CSS-class selectors, -2 hardcoded URLs = **-15 smells removed, +0 introduced**.
- **LOC delta:** 28 → ~22 LOC (-6 lines; hard waits + page.pause removed).
- **Anti-pattern coverage:** 15/15 cataloged.
