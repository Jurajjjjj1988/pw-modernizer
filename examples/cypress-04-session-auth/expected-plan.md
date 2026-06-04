# Migration plan: input.spec.ts

## Source framework
cypress

## Summary
Admin dashboard order list, accessed via a `cy.session()` cache that
re-runs the login on every spec. Migration replaces `cy.session` with
Playwright `storageState` produced by `global-setup` and consumed via
project config — sessions are produced once per CI run, not per spec.

### User-perceivable assertion checklist
- [x] Dashboard shows the orders list with at least one row.
- [x] Clicking an order row navigates to `/dashboard/orders/ord_<id>`
      and shows the "Order details" surface.

## Anti-patterns detected
- [x] `cy.session(..., { cacheAcrossSpecs: true })` without explicit cache
      invalidation (lines 5-14) — KB-1.2.15 `cy/fixture/session-no-cache-bust`.
      Replace with `storageState` produced in global-setup; auth flow
      versioning lives in the global-setup script, not test code.
- [x] `cy.clearCookies()` + `cy.clearLocalStorage()` in beforeEach (lines 16-17) —
      KB-1.2.45 `cy/fixture/manual-cleanup-ceremony`. Playwright per-test
      BrowserContext makes this automatic. Drop entirely.
- [x] CSS-id selectors `#email`, `#password` (lines 8, 9) — KB-1.2.25
      `cy/selector/css-id-over-role`. Switch to `getByLabel`.
- [x] `cy.get('button[type="submit"]')` (line 10) — KB-1.2.25. Use role+name.
- [x] Chained `.should('be.visible').should('contain', ...)` (line 21) —
      KB-1.2.31 `cy/assertion/chained-should-stale`. Use single web-first.
- [x] `cy.get('.order-row').its('length').should('be.gte', 1)` (line 22) —
      cypress-specific chai chain; rewrite with `toHaveCount` negation.
- [x] `cy.get('.order-row').eq(0)` index-based selector (line 26) —
      KB-1.2.2 `cy/selector/eq-index`. Use accessible name or first()
      with a filter.
- [x] `cy.url().should('match', regex)` then `cy.contains` (lines 27-28) —
      both are independent assertions split across lines; single
      `toHaveURL(regex)` + `toBeVisible` web-first chain reads cleaner.

## Locator translation table
| Original | New | Confidence | Notes |
|---|---|---|---|
| `cy.get('#email')` | `page.getByLabel('Email')` | medium | Assumes label association. Fallback: `getByRole('textbox', { name: /email/i })`. |
| `cy.get('#password')` | `page.getByLabel('Password')` | medium | Same. |
| `cy.get('button[type="submit"]')` | `page.getByRole('button', { name: 'Log in' })` | medium | Visible button text assumed; if different, swap name. |
| `cy.get('.order-list')` | `page.getByRole('region', { name: /orders/i })` | low | Could be a `<section>` with aria-label, a heading, or a div. Pin to fall back to `getByText('Orders')` if region not found. |
| `cy.get('.order-row')` | `page.getByRole('row')` | medium | Assumes semantic table; fallback `getByTestId('order-row')`. |
| `cy.get('.order-row').eq(0)` | `page.getByRole('row').first()` | medium | First-of-many is acceptable when the test asserts on shape, not on a specific row. |

## Hallucination-defense pins
1. **Log-in button label** — assumed `'Log in'`, keep `cy.get('button[type="submit"]')` shape in WHY-comment. Reviewer fallback: if real label is "Sign in" or just an icon, swap.
2. **Orders region role** — assumed `getByRole('region', { name: /orders/i })`, fallback `getByText('Orders').or(getByRole('heading', { name: /orders/i }))`.

## Structural changes
- Extract POM: no — two tests only, both share the same dashboard surface.
- Extract fixture: yes — `playwright/global-setup.ts` produces
  `playwright/.auth/admin.json`. Consumed by project config:
  `projects: [{ name: 'authed', use: { storageState: 'playwright/.auth/admin.json' } }]`.
- Split into multiple specs: no.

## Open questions for reviewer
- Does the login redirect to `/dashboard` first then the test navigates to
  `/dashboard/orders`, or does the migrated `storageState` jump directly?
  storageState carries cookies + localStorage; the first `goto('/dashboard/orders')`
  in the test should land authenticated.
- The Cypress test clears cookies AFTER setting them via `cy.session`.
  This is presumably a typo or test-author confusion — clearing immediately
  after caching defeats the cache. The migrated test simply doesn't
  clear (storageState owns the lifecycle).

## Risk callouts
- `cy.session` cache invalidation: the migrated `storageState.json` is
  regenerated only when the global-setup runs. If the auth flow changes
  (new MFA step, different form field), the cached state becomes stale
  silently. Document in `playwright/global-setup.ts` that the JSON is a
  cache artifact that must be regenerated on auth-flow changes.

## Expected metrics
- Selector quality score: 6/6 role/label-based.
- Smell count delta: -1 cy.session cache-bust smell, -2 cleanup ceremony
  smells, -1 chained should, -1 eq-index, -1 chai chain.
- LOC delta: 32 → 28 (-4 lines; storageState is set-once at config level).
- Anti-pattern coverage: 7/7.
