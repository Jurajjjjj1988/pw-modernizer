# Migration plan: input.spec.ts

## Source framework
cypress

## Summary
Settings page with three smells common in legacy Cypress suites:
conditional cookie-banner dismissal, jQuery attribute probing via
`cy.then($el => ...)`, and `cy.window().its('app.store')` reaching into
framework internals. Migration replaces all three with state-on-the-DOM
patterns: fixture-set cookies, web-first attribute assertions, and
user-perceivable assertions on the visible profile state.

### User-perceivable assertion checklist
- [x] After visiting settings, the Settings heading is visible.
- [x] After enabling dark mode, the dark-theme visual marker is applied.
- [x] After typing a new display name and saving, the visible display name
      reflects the new value.

## Anti-patterns detected
- [x] `cy.wait(500)` / `cy.wait(1500)` arbitrary waits (lines 5, 32) —
      KB-1.2.1 `cy/timing/hard-wait`. Replace with web-first assertions.
- [x] `if ($body.find('.cookie-banner').length > 0)` conditional inside
      test (lines 10-13) — KB-1.2.10 `cy/structure/conditional-in-test`.
      Fixture sets the cookie pre-test.
- [x] `cy.then(($el) => expect($el.attr(...)))` jQuery attr probing
      (lines 22-24) — KB-1.2.34 `cy/assertion/jquery-attr-sync`. Use
      `toHaveAttribute` web-first.
- [x] `cy.window().its('app.store')` framework internals leak (lines
      36-38) — KB-1.2.16 `cy/assertion/internals-leak`. Assert on visible
      state.
- [x] `.check({ force: true })` (line 20) — KB-1.2.4 `cy/action/force-true`.
      Wait for actionability or fix the underlying overlay issue.
- [x] `cy.clear().type(...)` (line 30) — KB-1.2.30 `cy/action/clear-then-type`.
      Use atomic `fill`.
- [x] `cy.contains('Save').click()` ambiguous text (line 31) — KB-1.2.6.
      Disambiguate with role.
- [x] `should('have.css', ...)` style coupling (line 26) — fragile.
      Assert on visible result (data-attribute) or screenshot diff.

## Locator translation table
| Original | New | Confidence | Notes |
|---|---|---|---|
| `cy.get('.cookie-banner').contains('Accept')` | (removed) | n/a | Pre-set via cookie fixture; no UI interaction. |
| `cy.get('h1')` | `page.getByRole('heading', { name: 'Settings', level: 1 })` | high | Heading text is "Settings". |
| `cy.get('input[name="darkMode"]')` | `page.getByLabel('Dark mode')` | medium | Assumes label association. |
| `cy.get('html')` | `page.locator('html')` | high | Direct mapping (no role for html element). |
| `cy.get('.theme-preview')` | `page.getByTestId('theme-preview')` | medium | Visual marker; testid is the conventional hook. |
| `cy.get('input[name="displayName"]')` | `page.getByLabel('Display name')` | medium | Same assumption. |
| `cy.contains('Save')` | `page.getByRole('button', { name: 'Save' })` | high | Save is a button. |

## Hallucination-defense pins
1. **Dark mode label** — assumed `'Dark mode'`, keep `cy.get('input[name="darkMode"]')` shape in WHY-comment. Reviewer fallback: if input has no label, use `getByRole('switch', { name: /dark/i })`.
2. **Theme preview hook** — assumed `getByTestId('theme-preview')`, fallback `page.locator('.theme-preview')`.

## Structural changes
- Extract POM: no — single page, single section.
- Extract fixture: yes — `cookiesAccepted` fixture pre-seeds the dismissal cookie via
  `page.context().addCookies([{ name: 'cookies_accepted', value: '1', domain: 'localhost', path: '/' }])`.
- Split into multiple specs: no.

## Open questions for reviewer
- The display-name save test asserts on the Redux store's `profile.displayName`.
  The migrated test asserts on the visible heading "Welcome, Alice" instead.
  Confirm the app renders the new display name somewhere user-visible after
  save — if not, the assertion needs to read from a profile dropdown or
  similar.
- The Cypress dark-mode test uses both `.attr('data-theme')` AND
  `should('have.css', ...)` — two assertions for the same state. Migration
  collapses to a single `toHaveAttribute('data-theme', 'dark')` assertion.
  If the CSS variable is the only signal (no data-attribute), restore the
  CSS assertion via `await expect(html).toHaveCSS('background-color', ...)`.

## Risk callouts
- The cookie-banner dismissal logic uses `$body.find('.cookie-banner')` —
  if the banner renders late (after initial DOM but before test runs), the
  conditional silently fails to find it and the test proceeds without
  dismissing. The migrated fixture pre-set avoids this race entirely.

## Expected metrics
- Selector quality score: 6/6 role/label/testid.
- Smell count delta: -2 hard waits, -1 conditional-in-test, -1 jquery-attr,
  -1 internals-leak, -1 force-true, -1 clear-then-type, -1 ambiguous-contains.
- LOC delta: 39 → 36 (-3 lines; fixture removes the conditional, web-first
  collapses the .then assertions).
- Anti-pattern coverage: 8/8.
