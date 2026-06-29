# Migration plan: bad-test.spec.ts

> Pre-canned mock plan returned by `npm run try-it -- --mock`. Mirrors the
> structure that `plan.yml`'s "Validate plan structure" step enforces so
> first-time operators see the real shape without spending Claude tokens.

## Source framework

**bad-playwright** — subtractive migration. Source is already Playwright TypeScript; the migration removes anti-patterns without translating a framework.

**Source file:** `examples/sample-suite/bad-test.spec.ts`
**Target file(s):** `outputs/tests/bad-test.spec.ts` (+ helper tree per pwm-blueprint)

## Summary

Single happy-path smoke for the Acme Cart storefront: pick the first listed product, add it to the cart, navigate to the cart, confirm a line item with a dollar total. Existing spec works locally but couples to render order, leans on hard waits, and uses a sync probe assertion that races the UI.

### What bug does this catch?

Catches a regression where adding a product no longer creates a cart line, or where the cart total no longer renders as currency.

### User-perceivable assertion checklist

- [ ] After add-to-cart: cart line item is visible
- [ ] Cart total contains a `$` character
- [ ] URL ends up on `/cart` (currently not asserted — see Risk callouts)

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 8 | KB-1.1.1 | hard-wait | `page.waitForTimeout(5000)` after goto | web-first assertion on first product card |
| H | 11 | KB-1.1.1 | hard-wait | `page.waitForTimeout(1500)` after click | remove — click auto-waits |
| H | 15 | KB-1.1.1 | hard-wait | `page.waitForTimeout(2000)` after add | `await expect(cartBadge).toContainText(/1/)` |
| H | 11 | KB-1.1.12 | nested-promise | `.click().then(async () => { ... })` | flat `await` sequence |
| H | 18 | KB-1.1.5 | sync-probe | `expect(await el.isVisible()).toBe(true)` | `await expect(el).toBeVisible()` |
| H | 19 | KB-1.1.5 | sync-probe | `expect(await el.innerText()).toContain('$')` | `await expect(el).toContainText('$')` |
| M | 10 | KB-1.1.3 | nth-roulette | `page.locator('.product-card').nth(0)` | `getByRole('link', { name: /first product name/i })` — see pin 1 |
| M | 12 | KB-1.1.3 | css-class | `page.locator('button.add-to-cart')` | `getByRole('button', { name: /add to cart/i })` |
| L | 7 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/products')` | configure `baseURL`; use `page.goto('/products')` |

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('.product-card').nth(0)` | `page.getByRole('link', { name: /first product name/i })` | low | Render order is unstable. If product names aren't predictable, use `getByTestId('product-card').first()` instead and accept the coupling. |
| `page.locator('button.add-to-cart')` | `page.getByRole('button', { name: /add to cart/i })` | high | Standard button role; safe upgrade. |
| `page.getByText('Cart')` | `page.getByRole('link', { name: /cart/i })` | med | Cart in headers is typically a link, not a heading. |
| `page.locator('.cart-line-item')` | `page.getByRole('listitem')` scoped to cart | med | If cart is a `<ul>`, prefer role-based; otherwise keep CSS and add WHY comment. |
| `page.locator('.cart-total')` | `page.getByTestId('cart-total')` | low | No clear ARIA role for an arbitrary total span. Request a `data-testid` from FE. |

## Hallucination-defense pins

1. **First product card** — assumed `getByRole('link', { name: /first product name/i })`. If product names are dynamic per run: keep `getByTestId('product-card').first()` with a WHY comment explaining the render-order coupling.
2. **Cart total** — assumed `getByTestId('cart-total')`. If no test id exists: keep `.cart-total` CSS class and add WHY comment `'Q-cart-total: data-testid not provisioned'`.

## Structural changes

- **Extract POM:** no — single test, ~20 LOC. Revisit when scenario #2 lands.
- **Extract fixture:** no — single `goto`.
- **Split into multiple specs:** no.

## Open questions for reviewer

- Q1: Is the product list sorted deterministically per environment, or does render order shift between runs?
- Q2: Does the cart total element carry a `data-testid` or an ARIA role we can target?
- Q3: Should the assertion include a URL check (`expect(page).toHaveURL(/\/cart/)`) to defend against false positives where the same DOM renders on a different route?

## Risk callouts

- **Render-order coupling.** `nth(0)` is the headline smell here. Even after migration, "first product" remains coupled to the list order unless the test pins a specific product by name. Flag for reviewer.
- **No URL assertion.** A page that coincidentally surfaces a cart-shaped element on a non-cart route would pass. Add `toHaveURL`.
- **Hardcoded test domain.** `shop.acme.test` should move to `baseURL` in `playwright.config.ts`.

## Expected metrics

- **Selector quality score (estimated):** 0.65 (3/5 role-based; 2 pending pin resolution).
- **Smell count delta:** -3 hard-waits, -1 nested promise, -2 sync probes, -2 CSS-class selectors, -1 hardcoded URL = **-9 smells removed, +0 introduced**.
- **LOC delta:** 21 → ~14 LOC (-7 lines).
- **Anti-pattern coverage:** 9/9 cataloged.
