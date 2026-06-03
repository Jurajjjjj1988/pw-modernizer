# Migration plan: input.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes silent-failure anti-patterns (conditional `if` branching and `try/catch` swallowing) without rewiring imports.

**Source file:** `examples/bad-playwright-03-silent-conditionals/input.spec.ts`
**Target file(s):** `examples/bad-playwright-03-silent-conditionals/expected-output.spec.ts`

## Summary

Dashboard page on the Acme Shop, post-login. Two scenarios: the welcome banner contains the user's name, and clicking the notifications widget reveals at least one notification item. Existing spec silently passes when either UI element fails to render — the conditional `if (await el.isVisible())` and the `try/catch` block both convert real regressions into green CI runs.

### What bug does this catch?

Catches a regression where (a) the dashboard welcome banner stops rendering (or stops including the user's first name), or (b) the notifications widget click stops surfacing notification items. Today's spec masks both regressions — fixing the silent conditionals is the entire point.

### User-perceivable assertion checklist

- [ ] After dashboard load: welcome banner is visible and contains `"Welcome back, Jane"`
- [ ] After click on notifications widget: at least one notification item is visible
- [ ] After click on notifications widget: first item contains `"New order"`

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 18 | KB-1.1.12 | conditional-logic | `if (await el.isVisible()) { ... } else { log }` | direct `await expect(...).toContainText(...)` |
| H | 27 | KB-1.1.13 | try-catch-swallow | `try { ... } catch (e) { console.log(e) }` | remove try/catch — let it throw |
| H | 19 | KB-1.1.5 | sync-probe | `expect(await el.innerText()).toContain(...)` | `await expect(el).toContainText(...)` |
| H | 29 | KB-1.1.5 | sync-probe | `expect(await firstNotif.innerText()).toContain(...)` | `await expect(...).toContainText(...)` |
| H | 7 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/login')` | configure `baseURL`; use `page.goto('/login')` |
| H | 11 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/dashboard')` | use `page.goto('/dashboard')` |
| M | 8 | KB-1.1.3 | css-id | `page.locator('#email')` | `page.getByLabel(/email/i)` |
| M | 9 | KB-1.1.3 | css-id | `page.locator('#password')` | `page.getByLabel(/password/i)` |
| M | 15 | KB-1.1.3 | css-class | `page.locator('.welcome-banner')` | `page.getByRole('banner', { name: /welcome/i })` (MED conf — see pins) |
| M | 25 | KB-1.1.3 | css-class | `page.locator('.notifications-widget')` | `page.getByRole('button', { name: /notifications/i })` (MED conf — see pins) |
| M | 28 | KB-1.1.3 | css-class | `page.locator('.notification-item').first()` | `page.getByRole('listitem').first()` (MED conf — see pins) |

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('#email')` | `page.getByLabel(/email/i)` | med | Assumes input has an associated `<label>`. Fall back to `getByRole('textbox', { name: 'Email' })`. |
| `page.locator('#password')` | `page.getByLabel(/password/i)` | med | Same assumption as Email. |
| `page.locator('.welcome-banner')` | `page.getByRole('banner').filter({ hasText: /welcome back/i })` | med | Page headers commonly use `role="banner"`. Fall back to `getByTestId('welcome-banner')` if not. |
| `page.locator('.notifications-widget')` | `page.getByRole('button', { name: /notifications/i })` | med | Widget click target is typically a button or link with an accessible name. If it is a div with `onClick`, that's an a11y bug — raise instead of hacking around. |
| `page.locator('.notification-item').first()` | `page.getByRole('listitem').first()` | med | Notifications are usually rendered as a list. If they use `<article>` instead, switch to `getByRole('article').first()`. |

## Hallucination-defense pins

1. **Welcome banner role** — assumed `getByRole('banner', { name: /welcome/i })`. If DOM lacks `role="banner"`: keep `.welcome-banner` CSS, add WHY-comment `'Q1 unresolved: banner role not confirmed'`. Reviewer fallback: ask FE team to add `role="banner"` OR `data-testid="welcome-banner"`.
2. **Notifications widget click target** — assumed accessible button with `aria-label="Notifications"`. If it's a `<div onClick>`: keep `.notifications-widget` CSS, add WHY-comment `'Q2: notifications widget a11y missing'`. Reviewer fallback: raise as a11y bug — keyboard users cannot reach the widget.
3. **Notification item element** — assumed `<li>` inside a list. If they use `<article>` or `<div role="listitem">`: switch to whichever role matches; keep `.notification-item` CSS as last resort. Reviewer fallback: ask FE team for the rendered DOM shape OR add `data-testid="notification-item"`.

## Structural changes

- **Extract POM:** no — single short spec, two scenarios, fixture overhead would outweigh the savings.
- **Extract fixture:** no — `beforeEach` does login + nav; it's repetitive across both tests but fits under the 3-line guideline OK (5 lines is borderline). If a third dashboard test lands, extract `authenticatedDashboardPage` fixture.
- **Split into multiple specs:** no — both scenarios target the same page.
- **Remove silent-failure paths:** yes — replace both `if (await el.isVisible())` and `try/catch` with direct web-first assertions. This is the entire migration motivation.

## Open questions for reviewer

- Q1: Does the welcome banner element use `role="banner"` or is it just a styled `<div>`?
- Q2: Is the notifications widget clickable as a `<button>`/`<a>`, or is it a div with an `onClick` handler? (The latter is an a11y bug we should NOT paper over.)
- Q3: Are notification items rendered as `<li>` inside a `<ul role="list">`, or some other structure?
- Q4: Is the A/B variant that hides the banner gated by user attribute or by feature flag? If by flag, test data should pin the flag so the banner ALWAYS renders for `jane.doe@acme.test` — that makes the assertion safe to leave unconditional.
- Q5: Why did the original author wrap notifications in `try/catch`? Was there a known intermittent failure (real bug) being suppressed? Check git blame for the original PR and any linked ticket.
- Q6: Are `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` provisioned as CI env vars? Plaintext credentials are committed today.

## Risk callouts

- **Silent conditional removal is a CORRECTNESS fix, not a stylistic one.** The original `if (await welcomeBanner.isVisible())` and `try { … } catch` blocks were converting failures into green runs. Removing them WILL surface any latent regression in the welcome banner or notifications widget — that's the point, but reviewer should expect either (a) tests now pass cleanly (good — coverage restored) or (b) they fail because of a real app regression that was being hidden. **Do not silently re-add the conditionals to make CI green** — that's how the bug got in originally.
- **A/B variant exposure.** If the welcome banner is genuinely gated by an A/B variant, the test will flake on the minority branch. Resolution: pin test users to the variant where the banner renders, OR raise with PM that the dashboard shouldn't have a "no banner" branch at all.
- **Notification ordering assumption.** Asserting on `"New order"` in the first notification item couples the test to backend notification ordering. If the test environment seeds multiple notification types, the first item could vary across runs. Suggest stubbing `/api/notifications` with a fixed first item.
- **Credential exposure.** `jane.doe@acme.test` and `Sup3rSecret!` are committed as plaintext. Migration to `process.env` references is NOT optional.
- **`beforeEach` weight.** The 5-line `beforeEach` (goto + 2 fills + click + goto) is borderline against the 3-line guideline. If a third test lands, this should become an `authenticatedDashboardPage` fixture.

## Expected metrics

- **Selector quality score (estimated):** 0.73 (5/7 role/label-based; 3 remain CSS-class pending pin resolution; 2 are HIGH-conf email/password label upgrades).
- **Smell count delta:** -1 conditional-if block, -1 try/catch swallow, -2 sync probes, -5 CSS-class/id selectors, -2 hardcoded URLs = **-11 smells removed, +0 introduced**.
- **LOC delta:** 33 → ~25 LOC (-8 lines; conditional + try/catch wrappers gone).
- **Anti-pattern coverage:** 11/11 cataloged.
