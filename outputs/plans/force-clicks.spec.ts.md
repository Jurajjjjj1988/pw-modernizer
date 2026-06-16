# Migration plan: force-clicks.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes anti-patterns (hardcoded URL, hardcoded credentials, `force: true` bypass, magic strings/numbers, assertion roulette) and restructures to the qa-master layered architecture.

**Source file:** `inputs/bad-playwright/force-clicks.spec.ts`
**Target file(s):** `outputs/tests/force-clicks.spec.ts` + POMs + fixture mutation + test-data constants

## Summary

Acme Shop post-login dashboard smoke check. The spec navigates to the login page, submits valid credentials, and then asserts four properties of the resulting dashboard: the URL has changed to `/dashboard`, five navigation links are present, a personalised welcome heading contains the user's first name, and a Logout button is visible. The source test uses `{ force: true }` to click past a newsletter modal that blocks the Sign-in button — the modal is never dismissed cleanly, and the actionability bug it masks is left unaddressed.

### What bug does this catch?

Catches a regression where the login form stops navigating the user to `/dashboard` after sign-in — whether due to a broken redirect, an unhandled overlay that permanently covers the submit button, or missing key UI elements on the resulting dashboard.

### User-perceivable assertion checklist

- [ ] After valid login: URL matches `/dashboard`
- [ ] After valid login: navigation contains exactly 5 links
- [ ] After valid login: welcome heading is visible and contains the user's first name (`Jane`)
- [ ] After valid login: Logout button is visible (confirming authenticated state)

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 7 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/login')` | configure `baseURL`; use relative `page.goto('/login')` |
| H | 8 | KB-1.1.9 | hardcoded-credential | `fill('jane.doe@acme.test')` | `process.env.TEST_USER_EMAIL` extracted to named constant |
| H | 9 | KB-1.1.9 | hardcoded-credential | `fill('Sup3rSecret!')` | `process.env.TEST_USER_PASSWORD` extracted to named constant |
| H | 12 | KB-1.1.4 | force-click | `.click({ force: true })` | dismiss newsletter modal first; then plain `.click()` |
| M | 15–18 | KB-1.1.10 | assertion-roulette | four unrelated `expect` calls in one test | split into focused scenario(s) or use `test.step` grouping |
| M | 17 | KB-1.1.9 | magic-string | `.toContainText('Jane')` | extract `VALID_USER_DISPLAY_NAME` constant |
| M | 16 | KB-1.1.9 | magic-number | `.toHaveCount(5)` | extract `NAV_LINK_COUNT = 5` or promote to named constant |

### Unclassified smells

**Wrong import source (qa-master conformance violation):**
Line 1 imports `test`/`expect` from `'@playwright/test'` directly. In the qa-master architecture only `outputs/helper/fixtures/base.fixture.ts` may import from `@playwright/test`; all specs must import from `'@fixtures/base.fixture'`. This is not cataloged under a `KB-1.1.x` entry but is enforced by `validate-qa-master-conformance.ts`. Stage 2 must change this import.

**Force-click root-cause note:**
The inline comment on line 11 — `"Newsletter modal overlay blocks the sign-in button. Force-click past it."` — reveals that `force: true` is masking a real actionability failure. The newsletter modal is an active UI element that a real user would need to dismiss. The migration MUST replace the force-click with an explicit modal-dismissal step (see Open questions Q1–Q3). Leaving `force: true` would pass the `eslint-plugin-playwright/no-force-option` rule violation but the actual bug (modal blocking an interactive element) would remain untested.

## Locator translation table

Since this is a subtractive bad-playwright migration, every existing locator is already on the canonical role/label hierarchy. The only locator requiring translation is the newsletter modal's close control, which must be added net-new (it is absent from the source). Existing locators are listed only where their usage changes.

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.goto('https://shop.acme.test/login')` | `page.goto('/login')` | high | Mechanical: absolute URL → relative, `baseURL` from `playwright.config.ts` |
| `page.getByLabel('Email')` | `page.getByLabel('Email')` (unchanged) | high | Already role/label-based; no change needed |
| `page.getByLabel('Password')` | `page.getByLabel('Password')` (unchanged) | high | Already role/label-based; no change needed |
| `page.getByRole('button', { name: 'Sign in' }).click({ force: true })` | First: dismiss modal (see pin 1); then `page.getByRole('button', { name: 'Sign in' }).click()` | high (for the button itself) | The button locator is already correct; only the `{ force: true }` option is removed. The modal-dismissal locator is a net-new addition. |
| *(net-new)* newsletter modal close control | `page.getByRole('button', { name: /close|dismiss/i })` or `page.getByLabel(/close newsletter/i)` | low | No DOM evidence in the source; comment only says "Newsletter modal overlay". Reviewer must verify element type, role, and accessible name. See pin 1. |
| `page.getByRole('navigation').getByRole('link')` | `page.getByRole('navigation').getByRole('link')` (unchanged) | high | Already correct compound role-based locator |
| `page.getByRole('heading', { name: /welcome back/i })` | `page.getByRole('heading', { name: /welcome back/i })` (unchanged) | high | Already correct; `.toContainText('Jane')` assertion becomes `.toContainText(VALID_USER_DISPLAY_NAME)` |
| `page.getByRole('button', { name: 'Logout' })` | `page.getByRole('button', { name: 'Logout' })` (unchanged) | high | Already correct |

## Hallucination-defense pins

1. **Newsletter modal close control** — assumed `page.getByRole('button', { name: /close|dismiss/i })`. If DOM contradicts (e.g. the control is an icon-only `<span>` or a link with no accessible name): keep a `page.locator('[data-testid="newsletter-close"]')` CSS fallback, add WHY-comment `'Q1 unresolved: newsletter modal close locator not confirmed'`. Reviewer fallback: walk the live SUT with the Playwright inspector (`--debug`) on page load to snapshot the modal's ARIA tree; capture the accessible name of the close control. If no accessible name exists, request that the frontend team add `aria-label="Close newsletter"` to the close button.

2. **Newsletter modal presence assumption** — assumed the modal is always shown on first visit to `/login`. If the modal is gated (only first-visit session, cookie-controlled, A/B-tested): the modal dismissal step will fail intermittently. Add WHY-comment `'Q2 unresolved: modal appearance conditions not confirmed'`. Reviewer fallback: add a conditional fixture-level guard (`page.addInitScript`) to set the newsletter cookie to opted-in state before navigation, preventing the modal from rendering at all — this is cleaner than dismissing it per-test.

## Structural changes

**Extract POM: yes** — two pages are visited (login → dashboard), and qa-master requires at least one POM per visited page. A `PageClassLogin` encapsulates the email/password fields, the Sign-in button, and the newsletter modal dismissal. A `PageClassDashboard` encapsulates the four post-login assertions as POM properties.

**Extract Action: no** — the login flow crosses `PageClassLogin` → `PageClassDashboard`, which would normally trigger an `actions/` extraction. However, this spec IS the one test that owns the login flow; extracting an action here adds indirection without a consumer. Reconsider when a second spec needs to reach the dashboard as a precondition (at that point, extract `outputs/helper/actions/login.ts` and let both specs use it via the `authenticated.fixture.ts` pattern).

**Extract fixture: yes (mutate base.fixture.ts)** — add `loginPage: PageClassLogin` and `dashboardPage: PageClassDashboard` as injectable fixtures so the spec never calls `new PageClass*(page)` manually.

**Split into multiple specs: no** — all four assertions are consequents of the same login action and share the same precondition. Splitting into four single-assertion tests would require re-running the full login flow for each, which is expensive and adds no diagnostic clarity beyond what `test.step` grouping already provides. Reviewer may reconsider if the nav-link count (currently 5) is a structural assertion the team would prefer to track in a separate spec (see Q5).

**New test-data files:** `outputs/helper/test-data/labels.ts` (mutate — add `LABEL_LOGIN` and `LABEL_DASHBOARD` constants) and `outputs/helper/test-data/urls.ts` (mutate — add `URL_LOGIN = '/login'`).

### File summary

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/login.page.ts` | owns email/password/sign-in locators + newsletter modal dismissal method |
| Page | `outputs/helper/page-object/pages/dashboard.page.ts` | owns nav, heading, logout locators for post-login assertions |
| Block | (none) | neither page section reaches 5+ locators or 3+ methods requiring block extraction |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | add `loginPage` and `dashboardPage` injectable fixtures |
| API | (none) | source test IS the login flow owner — no data-prep needed |
| Action | (none) | single spec is the only consumer; extract when second consumer appears |
| Utility | (none) | no parsing or calculation required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | add `LABEL_LOGIN = 'Login'` and `LABEL_DASHBOARD = 'Dashboard'` |
| Test-data | `outputs/helper/test-data/urls.ts` (mutate) | add `URL_LOGIN = '/login'` |
| Type | (none) | no new API response shapes or internal value objects |
| Spec | `outputs/tests/force-clicks.spec.ts` | the migrated test |

## Open questions for reviewer

```
Q1: What is the newsletter modal close control's role and accessible name?
Context: line 12 comment says "Newsletter modal overlay blocks the sign-in button"; the modal is dismissed
        via force-click in the source. The migration needs an explicit locator for the close control.
What I assumed (if proceeding without an answer): page.getByRole('button', { name: /close|dismiss/i })
Impact if my assumption is wrong: Stage 2 emits a locator that targets the wrong element or throws
        "strict mode violation" if multiple close-labelled buttons exist on the page.
```

```
Q2: Is the newsletter modal always shown on the first visit to /login, or is it gated
    by a cookie / session flag / A/B test?
Context: if it's not always present, a modal-dismissal step in the test body will fail intermittently
        when the modal is suppressed.
What I assumed (if proceeding without an answer): the modal is always shown on the first GET /login
        in a fresh BrowserContext (which is the Playwright per-test default).
Impact if my assumption is wrong: the dismissal step throws "element not found" on runs where the modal
        is suppressed, causing false CI failures that obscure real login regressions.
```

```
Q3: Should the newsletter modal be handled in a fixture rather than in the test body?
Context: if the modal appears on every page load (Q2 answer = always), it's a cross-cutting concern
        that belongs in the base fixture's `page` override (via addInitScript to set the opt-in cookie
        before the page loads), not in the individual spec.
What I assumed (if proceeding without an answer): modal dismissal stays in the spec body as a
        test.step — this is the safer default since we don't know the cookie name.
Impact if my assumption is wrong: every future spec visiting /login will need the same dismissal step
        copy-pasted, which creates duplication that should instead live in the fixture.
```

```
Q4: Are TEST_USER_EMAIL and TEST_USER_PASSWORD already provisioned as CI environment variables?
Context: lines 8–9 hardcode 'jane.doe@acme.test' / 'Sup3rSecret!'. Stage 2 replaces these with
        process.env.TEST_USER_EMAIL and process.env.TEST_USER_PASSWORD.
What I assumed (if proceeding without an answer): the env vars exist in CI (standard migration assumption).
Impact if my assumption is wrong: the test throws at startup with a "missing env var" error on every CI
        run until the vars are provisioned.
```

```
Q5: Is the nav-link count of 5 a meaningful business assertion or a structural brittle check?
Context: line 16 asserts toHaveCount(5) on navigation links with a magic number 5.
What I assumed (if proceeding without an answer): the count is meaningful (5 primary nav sections)
        and should be preserved as a named constant NAV_LINK_COUNT = 5 with a
        // Walk-and-Watch comment documenting when it was confirmed.
Impact if my assumption is wrong: if the nav link count changes with a routine feature (6th section
        added), the test will break with no product regression — pure structural coupling. In that case,
        remove the count assertion entirely and only assert the subset of links the test cares about.
```

```
Q6: Does 'Jane' in the welcome heading assertion represent a stable account name in the test environment,
    or could it change (profile rename, locale, etc.)?
Context: line 17 asserts .toContainText('Jane') — a hardcoded first name that couples the test to
        one account's current display name.
What I assumed (if proceeding without an answer): 'Jane' is a stable test-account name; extracted to
        VALID_USER_DISPLAY_NAME = 'Jane' constant. Stage 2 changes the assertion to
        .toContainText(VALID_USER_DISPLAY_NAME).
Impact if my assumption is wrong: any profile rename or locale change breaks the assertion with no
        product regression signal (the heading still shows something; just not this name).
        If unstable: change to .toContainText(/welcome back/i) — verifies the greeting structure
        without coupling to a specific name.
```

## Risk callouts

- **Modal locator hallucination risk (high).** The newsletter modal close control has NO DOM evidence in the source — only a prose comment. Pin 1 documents the fallback, but Stage 2 cannot produce a verified locator without a DOM snapshot or reviewer input from Q1. This is the highest-risk item in this migration.

- **Modal appearance non-determinism.** If the modal is cookie-controlled and the Playwright per-test `BrowserContext` is fresh (no cookies), the modal will appear every run — which is actually safe. However, if a previous test in the same worker somehow leaked the opt-in cookie, the modal will NOT appear and the dismissal step will throw. Addressed by either fixture-level cookie pre-set (Q3) or adding `.catch(() => {})` to the dismissal step (acceptable only per migration-rules §3: "Optional elements: `.catch(() => {})`, never `try/catch`").

- **Nav-link count brittleness.** The `toHaveCount(5)` assertion on navigation links will break whenever the primary nav changes — a new feature section, a seasonal promotion link, an A/B variant. This is a structural assertion, not a behaviour assertion. If the reviewer answers Q5 with "remove it", Stage 2 should drop the count check.

- **Credential exposure in git history.** `jane.doe@acme.test` and `Sup3rSecret!` are committed in plaintext to `inputs/bad-playwright/force-clicks.spec.ts`. The migration removes them from the output but they remain in git history. If the credentials are real (not fictional test values), the team should rotate them.

- **Assertion scope after modal split.** The four assertions currently execute in sequence after a single login action. If the modal dismissal step is added as a `test.step`, and that step fails (Q1 / Q2), all four assertions will be reported as failing even though the Sign-in button locator itself is correct. Stage 2 should structure steps so the modal-dismissal failure message is unambiguous.

## Expected metrics

- **Selector quality score (estimated):** 0.88 (7/8 locators are role/label-based; the newsletter modal close locator is the one MED/LOW item)
- **Smell count delta:** -1 hardcoded URL, -2 hardcoded credentials, -1 `force: true`, -1 magic string (`'Jane'`), -1 magic number (`5`), -1 assertion roulette, -1 wrong import source = **-8 smells removed, +0 introduced**
- **LOC delta:** source ~21 LOC → spec ~35 LOC (+14); LoginPage ~30 LOC; DashboardPage ~25 LOC; net new code including POMs and test-data mutations: +~70 LOC vs source
- **Anti-pattern coverage:** 7/7 cataloged (+ 1 unclassified import-source smell)
