# Migration plan: input.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes a `force: true` overlay bypass, splits assertion-roulette into focused tests, and extracts the login flow into a shared fixture.

**Source file:** `examples/bad-playwright-05-force-clicks/input.spec.ts`
**Target file(s):** `examples/bad-playwright-05-force-clicks/expected-output.spec.ts`

## Summary

Post-login dashboard smoke check on the Acme Shop. A single test today asserts four unrelated outcomes (URL, nav link count, greeting text, logout button visibility) — when any one fails, the others are not evaluated and the failure source is ambiguous. The same test force-clicks past a newsletter modal that blocks the Sign in button, masking a real regression where the modal becomes undismissable.

### What bug does this catch?

Catches regressions where (a) the newsletter modal becomes undismissable (today masked by `force: true`), (b) login no longer routes to `/dashboard`, (c) the primary navigation drops or gains a link, (d) the welcome heading no longer includes the user's first name, or (e) the logout button no longer renders for signed-in users. Each becomes its own failing test so the failure source is unambiguous.

### User-perceivable assertion checklist

- [ ] After click Close on newsletter modal: modal dismisses without `force: true`
- [ ] After sign in: URL matches `/\/dashboard/`
- [ ] After dashboard load: primary navigation contains exactly 5 links
- [ ] After dashboard load: welcome heading contains `"Jane"`
- [ ] After dashboard load: Logout button is visible

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 12 | KB-1.1.4 | force-click | `.click({ force: true })` | dismiss the modal first via Close button |
| H | 6 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/login')` | configure `baseURL`; use `page.goto('/login')` |
| M | 15-18 | KB-1.1.10 | assertion-roulette | 4 unrelated expects in one `test()` | split into 4 focused tests |
| L | 5 | KB-1.1.10 | wide-test-title | `'user can log in and view the full dashboard'` | per-behaviour titles after split |

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.getByLabel('Email')` | unchanged | high | Already label-based — preserve. |
| `page.getByLabel('Password')` | unchanged | high | Already label-based — preserve. |
| `page.getByRole('button', { name: 'Sign in' })` | unchanged | high | Already role+name. |
| (new) Newsletter modal Close button | `page.getByRole('dialog', { name: /newsletter/i }).getByRole('button', { name: /close/i })` | med | Newsletter overlays commonly use `role="dialog"` with an aria-label or aria-labelledby pointing at the heading. Fall back to `getByTestId('newsletter-modal-close')` if not. |
| `page.getByRole('navigation').getByRole('link')` | unchanged | high | Role+role chain is idiomatic. |
| `page.getByRole('heading', { name: /welcome back/i })` | unchanged | high | Already role+name. |
| `page.getByRole('button', { name: 'Logout' })` | unchanged | high | Already role+name. |

## Hallucination-defense pins

1. **Newsletter modal element** — assumed `getByRole('dialog', { name: /newsletter/i })`. If DOM uses a styled `<div>` with no `role="dialog"`: keep `page.locator('.newsletter-modal')` CSS (degraded), add WHY-comment `'Q1 unresolved: newsletter modal role not confirmed'`. Reviewer fallback: ask FE team to add `role="dialog" aria-label="Newsletter signup"` — undismissable modals without a dialog role are also a screen-reader regression.
2. **Newsletter modal Close button** — assumed `getByRole('button', { name: /close/i })`. If the close affordance is an `<svg>` with no accessible name (icon-only close button): the test cannot find it by role and the migration legitimately cannot proceed without an FE change. Reviewer fallback: raise as a11y bug; add `aria-label="Close"` to the close button; or as last resort use `data-testid="newsletter-close"`.

## Structural changes

- **Extract POM:** no — only one feature (dashboard smoke), four tests; inline locators stay readable. Reconsider if a sixth dashboard test lands.
- **Extract fixture:** yes — `signedInPage` fixture handles login + newsletter-modal dismissal + dashboard navigation. All four split tests start from the same baseline; without the fixture the modal-dismiss + login would repeat 4×.
- **Split into multiple specs:** no — all four tests target the same dashboard feature and share the same fixture, so they belong in one file.
- **Split assertion-roulette into focused tests:** yes — the 4-expect "user can log in and view the full dashboard" test becomes 4 tests, each pinning a single user-perceivable outcome (URL, nav count, greeting, logout button). When one fails, the failure source is unambiguous.
- **Remove `force: true`:** yes — dismiss the newsletter modal via its Close button instead of force-clicking past it. The previous code converted "modal stuck open" regressions into green runs.

## Open questions for reviewer

- Q1: Does the newsletter modal use `role="dialog"` with an accessible name? If not, that's an a11y bug — but also blocks the role-based locator in the fixture.
- Q2: Does the newsletter modal's Close button have an `aria-label="Close"` (or visible text)? Icon-only close buttons without aria-label cannot be targeted by role.
- Q3: Is the newsletter modal feature-flagged or A/B tested? If it sometimes does NOT appear (e.g., for users who have already dismissed it), the fixture's `getByRole('dialog')` click will time out. Resolution: clear `localStorage.newsletterDismissed` in fixture setup, OR use `dialog.or(noOp)` pattern with a guard.
- Q4: Is the nav-link count of `5` stable? A feature flag that adds/removes a link silently breaks this test. Consider asserting on specific link names (`Home`, `Products`, `Cart`, `Orders`, `Account`) instead of a count — that catches both presence AND ordering regressions.
- Q5: Why did the original author use `force: true`? Was the newsletter modal a recent addition that surfaced after the test was written? Check git blame for context — there may be a related a11y or UX ticket worth referencing.
- Q6: Are `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` provisioned as CI env vars? Plaintext credentials should not be committed.

## Risk callouts

- **`force: true` removal surfaces masked overlay bugs.** The previous test green-washed any state where the newsletter modal couldn't be dismissed (locked focus trap, missing close handler, z-index regression). Replacing with a real Close click means CI will now fail when those bugs ship. **Do not re-add `force: true` to make CI green** — that's how the bug got in originally.
- **Test split is a CORRECTNESS improvement, not a refactor.** Asserting 4 things in one test means when one fails, the other three are silently un-evaluated. After the split, a regression in the nav-link count no longer hides regressions in the welcome heading. Reviewer should expect: (a) all 4 tests pass cleanly (good — full coverage restored), or (b) the test that was previously failing first now fails alone AND newly-evaluated tests fail behind it, surfacing a multi-regression.
- **Fixture login cost.** Splitting one test into four means the login flow runs four times per worker (once per test via the fixture). On a slow CI runner that's ~4× the cost of the original. Consider `storageState` for shared auth if total runtime regresses noticeably — Playwright auth docs at [playwright.dev/docs/auth](https://playwright.dev/docs/auth).
- **Credential exposure.** Plaintext credentials committed today; migration to `process.env` references is NOT optional.
- **Newsletter modal is a fixture-level concern, not per-test.** Per migration-rules.md §1.1.12, conditional UI handling belongs in the fixture, not in individual tests. Putting modal dismissal in `signedInPage` enforces this.

## Expected metrics

- **Selector quality score (estimated):** 0.92 (12/13 locators are role/label-based; 1 newsletter-modal-close is MED pending pin resolution).
- **Smell count delta:** -1 force-click, -1 assertion-roulette (4-expect collapse), -1 hardcoded URL = **-3 smells removed, +0 introduced**. (Test count increases 1 → 4, fixture adds ~12 LOC, but each individual test is now hermetic and reports a single failure cause.)
- **LOC delta:** 18 → ~45 LOC (+27 lines; the fixture extraction + test split intentionally trade compactness for failure-isolation).
- **Anti-pattern coverage:** 4/4 cataloged (force-click, assertion-roulette, hardcoded URL, wide-test-title).
