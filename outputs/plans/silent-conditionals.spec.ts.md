# Migration plan: silent-conditionals.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes anti-patterns without rewiring the import to a different framework. However, this is not a trivially subtractive migration: both test bodies are structurally inert — one uses `if (await isVisible())` conditional logic and the other uses `try/catch` to swallow failures, meaning neither test can detect the regression it claims to detect. The migration must replace both patterns with deterministic web-first assertions, resolve the A/B-variant non-determinism via fixture-level state, and lift the hardcoded UI-login `beforeEach` into an API-backed authenticated fixture per qa-master discipline.

**Source file:** `inputs/bad-playwright/silent-conditionals.spec.ts`
**Target spec:** `outputs/tests/silent-conditionals.spec.ts`

## Summary

An Acme Shop dashboard suite that intends to verify two user-perceivable outcomes after login: that a personalised welcome banner renders with the user's display name, and that a notifications widget renders and contains at least one item. Both test bodies are currently inert. Test 1 wraps its only assertion in an `if (await welcomeBanner.isVisible())` guard that silently passes (with a `console.log`) when the A/B variant is off — assigning "green" to a state where nothing was checked. Test 2 wraps its entire body (click + assertion) in a `try/catch` that logs and silently continues on any failure, meaning the test can never go red. The migration must demolish both silent-pass patterns, establish deterministic fixture state for the A/B variant, and wire genuine web-first assertions.

### What bug does this catch?

Catches a regression where an authenticated user's dashboard silently fails to render the personalised welcome banner or the notifications widget — a class of breakage the current tests would not detect because both bodies are designed to pass even when the elements are absent.

### User-perceivable assertion checklist

- [ ] After authenticated dashboard load (A/B variant forced ON): welcome banner is visible
- [ ] After authenticated dashboard load: welcome banner contains the authenticated user's display name (or a name-bearing pattern)
- [ ] After authenticated dashboard load: notifications widget is visible
- [ ] After interacting with notifications widget: at least one notification item is visible containing notification text

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 6 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/login')` | `baseURL` in config + relative path; move to auth fixture |
| H | 7 | KB-1.1.9 | hardcoded-credential | `'jane.doe@acme.test'` | `process.env.TEST_USER_EMAIL` in auth fixture |
| H | 8 | KB-1.1.9 | hardcoded-credential | `'Sup3rSecret!'` | `process.env.TEST_USER_PASSWORD` in auth fixture |
| H | 10 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/dashboard')` | `dashboardPage.open()` with relative path via `baseURL` |
| H | 17–21 | KB-1.1.12 | conditional-logic | `if (await welcomeBanner.isVisible()) {…}` | `await expect(dashboardPage.welcomeBanner).toBeVisible()` — unconditional |
| H | 19 | KB-1.1.19 | sync-probe (innerText) | `expect(await welcomeBanner.innerText()).toContain…` | `await expect(dashboardPage.welcomeBanner).toContainText(…)` |
| H | 25–31 | KB-1.1.13 | try/catch swallowing failure | `try { await widget.click()… } catch (e) {…}` | remove try/catch; Playwright actions throw naturally |
| H | 30 | KB-1.1.19 | sync-probe (innerText) | `expect(await firstNotification.innerText()).toContain…` | `await expect(dashboardPage.firstNotification).toContainText(…)` |
| M | 14 | KB-1.1.3 | css-class selector | `page.locator('.welcome-banner')` | role/testid-based; see locator table (LOW conf) |
| M | 20 | KB-1.1.23 | console.log debug residue | `console.log('Welcome banner not rendered…')` | remove; conditional entire block removed |
| M | 26 | KB-1.1.3 | css-class selector | `page.locator('.notifications-widget')` | role/testid-based; see locator table (LOW conf) |
| M | 29 | KB-1.1.3 | css-class selector | `page.locator('.notification-item')` | role/testid-based; see locator table (LOW conf) |
| M | 29 | KB-1.1.2 | index selector without comment | `.first()` on CSS-class collection | name-based or `getByRole` + `// TODO: fragile` comment |
| M | 31 | KB-1.1.23 | console.log debug residue | `console.log('Notifications widget failed…')` | remove; the enclosing try/catch is also removed |
| L | 7 | KB-1.1.3 | css-id as primary selector | `page.locator('#email')` | `page.getByLabel(/email/i)` (MED conf); moves to auth fixture |
| L | 8 | KB-1.1.3 | css-id as primary selector | `page.locator('#password')` | `page.getByLabel(/password/i)` (MED conf); moves to auth fixture |
| L | 19 | KB-1.1.9 | magic string (display name) | `'Welcome back, Jane'` | extract to `EXPECTED_GREETING_PATTERN` constant or regex |

### Unclassified smells

- **`beforeEach` performs UI login with no success assertion** (lines 5–11): four Playwright actions (goto, fill, fill, click) execute without any assertion that login succeeded before `goto('/dashboard')` is called. If the login form rejects the credentials silently, both tests navigate to the dashboard cold and fail with a misleading "element not found" error rather than a "login failed" error. This is the inverse of KB-1.1.10 (assertion roulette) applied to setup code. Fix: lift login into `authenticated.fixture.ts` backed by `accounts.api.ts`, making the explicit `beforeEach` unnecessary.
- **Second `page.goto` after login may be redundant** (line 10): if the app redirects to `/dashboard` on successful login, the explicit second `goto('…/dashboard')` navigates a second time, potentially discarding redirect-embedded tokens or state. Reviewer should confirm whether the redirect exists (see Q9).

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('#email')` | `page.getByLabel(/email/i)` | med | Assumes login form has `<label>` for the email input. Moves entirely to `authenticated.fixture.ts`. Fall back: `getByRole('textbox', { name: /email/i })`. |
| `page.locator('#password')` | `page.getByLabel(/password/i)` | med | Assumes login form has `<label>` for the password input. Moves entirely to `authenticated.fixture.ts`. Fall back: `getByRole('textbox', { name: /password/i })`. |
| `page.getByRole('button', { name: 'Sign in' })` | `page.getByRole('button', { name: /sign in/i })` | high | Already role-based; widen to regex for copy-variation resilience. Moves to `authenticated.fixture.ts`. |
| `page.locator('.welcome-banner')` | `page.getByRole('region', { name: /welcome/i })` | low | No DOM snapshot. Element could be `<section>`, `<aside>`, `<div>`, `role="alert"`, or `role="status"`. See pin 1. |
| `page.locator('.notifications-widget')` | `page.getByRole('region', { name: /notifications/i })` | low | No DOM snapshot. Same uncertainty as welcome-banner. See pin 2. |
| `page.locator('.notification-item').first()` | `page.getByRole('listitem').first()` | low | No DOM snapshot. Items could be `<li>`, `<tr>`, `<article>`, or a custom element. See pin 3. |

## Hallucination-defense pins

1. **Welcome banner** — assumed `page.getByRole('region', { name: /welcome/i })`. If DOM contradicts (no region/sectioning element): keep `page.locator('.welcome-banner')`, add WHY-comment `'Q1 unresolved: .welcome-banner role unknown — assumed region'`. Reviewer fallback: ask FE team to add `data-testid="welcome-banner"` and switch to `page.getByTestId('welcome-banner')`, OR confirm the HTML element type so the correct role can be used.

2. **Notifications widget** — assumed `page.getByRole('region', { name: /notifications/i })`. If DOM contradicts: keep `page.locator('.notifications-widget')`, add WHY-comment `'Q2 unresolved: .notifications-widget role unknown — assumed region'`. Reviewer fallback: ask FE team to add `data-testid="notifications-widget"`.

3. **Notification item (first)** — assumed `page.getByRole('listitem').first()`. If DOM contradicts (not `<li>` elements): keep `page.locator('.notification-item').first()`, add WHY-comment `'Q3 unresolved: .notification-item element type unknown — assumed li'`. Reviewer fallback: add `data-testid="notification-item"` and switch to `page.getByTestId('notification-item').first()`.

4. **Email / password inputs (auth fixture)** — assumed `page.getByLabel(/email/i)` / `page.getByLabel(/password/i)` in the auth fixture. If the login form has no `<label>` elements (placeholder-only design): fallback is `page.getByRole('textbox', { name: /email/i })` for email and `page.getByRole('textbox', { name: /password/i })` for password. If neither label nor accessible name is present, use `page.locator('#email')` / `page.locator('#password')` (IDs appear stable) and add WHY-comment `'Q1-auth: no <label> found — falling back to ID selector'`.

5. **A/B welcome-banner variant** — assumed that a cookie or `localStorage` key exists that forces the banner to render in the test fixture (e.g. `feature_welcome_banner=enabled`). If no such control exists: the banner scenario cannot be made deterministic via fixture; Stage 2 must tag the test `@edge` and wrap with `test.fixme('Q4: A/B variant unresolved — banner may not render')`. Reviewer fallback: confirm the variant-control mechanism with product/FE, or accept a test that only runs in environments where the variant is always on.

## Structural changes

- **Extract Page:** yes — `outputs/helper/page-object/pages/dashboard.page.ts` (`PageClassDashboard` extending `BasePage`). No constructor; `readonly` fields with `.describe('[Dashboard] …')`. Exposes: `welcomeBanner`, `notificationsWidget`, `firstNotification`. `open()` navigates to `/dashboard` and awaits `waitForPageLoad()`.
- **Extract authenticated fixture:** yes — `outputs/helper/fixtures/authenticated.fixture.ts` (create). Extends `base`; creates a fresh API-backed session via `accounts.api.ts` and injects session cookies. Replaces the UI-login `beforeEach` entirely.
- **Mutate base fixture:** yes — `outputs/helper/fixtures/base.fixture.ts` (mutate). Add `dashboardPage: PageClassDashboard` injection. If an A/B variant cookie exists (per Q4), add it to the auto-`page` fixture block here.
- **Extract API wrapper:** yes — `outputs/helper/api/accounts.api.ts` (create). Exposes `createSession(email: string, password: string): Promise<Cookie[]>` used by the authenticated fixture. Never called from a Page.
- **Test-data:** `outputs/helper/test-data/labels.ts` (mutate) — add `LABEL_DASHBOARD = "Dashboard"`. If A/B cookie confirmed (Q4): `outputs/helper/test-data/cookies.ts` (create/mutate) — add `COOKIE_AB_WELCOME_BANNER` constant.
- **Import rewiring:** spec imports `test`/`expect` from `@fixtures/base.fixture`, never from `@playwright/test`.
- **Split into multiple specs:** no — two tests, one feature (dashboard widget rendering); single `test.describe` is appropriate.
- **Flatten `beforeEach`:** yes — the UI-login `beforeEach` is dropped entirely; auth is via fixture.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/dashboard.page.ts` | Encapsulates dashboard locators; replaces inline CSS-class locators in both tests |
| Block | (none) | Two sections but neither reaches 5+ locators; no cross-page reuse |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add `dashboardPage` injection; optional A/B cookie in auto-`page` block |
| Fixture | `outputs/helper/fixtures/authenticated.fixture.ts` (create) | Replaces UI-login `beforeEach`; API-backed session per test |
| API | `outputs/helper/api/accounts.api.ts` (create) | `createSession(email, password)` → session cookies; called from auth fixture only |
| Action | (none) | Single-page journey; no cross-POM flow |
| Utility | (none) | No raw DOM string parsing |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | Add `LABEL_DASHBOARD = "Dashboard"` |
| Test-data | `outputs/helper/test-data/cookies.ts` (create/mutate) | Add `COOKIE_AB_WELCOME_BANNER` (value TBD via Q4) |
| Type | (none) | No new API response shapes |
| Spec | `outputs/tests/silent-conditionals.spec.ts` | The migrated test |

## Open questions for reviewer

```
Q1: What HTML role / element type is `.welcome-banner`?
Context: Line 14. Proposed `page.getByRole('region', { name: /welcome/i })` at LOW confidence.
What I assumed: a sectioning element (<section>/<aside>) with an accessible name matching /welcome/.
Impact if wrong: Stage 2 emits a locator that finds 0 elements; test fails with "no element matching region[name=/welcome/]" instead of a meaningful assertion.

Q2: What HTML role / element type is `.notifications-widget`?
Context: Line 26. Proposed `page.getByRole('region', { name: /notifications/i })` at LOW confidence.
What I assumed: a sectioning element with an accessible name matching /notifications/.
Impact if wrong: same as Q1.

Q3: What is the HTML element type of `.notification-item`?
Context: Line 29. Proposed `page.getByRole('listitem').first()` at LOW confidence.
What I assumed: items are <li> elements inside a <ul>/<ol>.
Impact if wrong: 0 listitems found; test fails misleadingly.

Q4: How is the welcome-banner A/B variant controlled in test environments?
Context: Line 16 comment says "Banner sometimes doesn't render if A/B variant is off". The migration proposes forcing the variant ON via a cookie or localStorage entry in the fixture.
What I assumed: a cookie (e.g. feature_welcome_banner=enabled) or localStorage key can be set before page load to guarantee the banner renders.
Impact if wrong: if the variant is server-side only (e.g. tied to a user flag in the database), the cookie approach will not work. Migration must instead either mock the A/B-control API response, seed the flag in the API call that creates the test user, or tag the test test.fixme() with a note for the reviewer.

Q5: Does clicking `.notifications-widget` (line 28) open/expand the widget, or is it always visible?
Context: Line 28, `await notificationsWidget.click()`. If the widget is always visible, the click is an unintended interaction.
What I assumed: the click expands an accordion or activates the widget.
Impact if wrong: if widget is always open, the click is noise and should be removed from the migration.

Q6: Does the test environment have a seeded "New order" notification for the authenticated user?
Context: Line 30 asserts `.toContain('New order')`. A fresh API-created user (per Q7) will have no notifications.
What I assumed: the test environment is pre-seeded, OR the `accounts.api.ts` call can also seed a notification.
Impact if wrong: assertion fails with "expected text 'New order' not found" on a correctly-working widget. Fix: either loosen assertion to `await expect(dashboardPage.firstNotification).toBeVisible()` only, or add a `createNotification(userId)` call to the auth fixture.

Q7: Is there an API endpoint the test can use to create an authenticated session?
Context: beforeEach does UI login; qa-master wants API-backed auth in authenticated.fixture.ts.
What I assumed: an endpoint exists (e.g. POST /api/auth/login or POST /api/sessions) returning session cookies.
Impact if wrong: if no auth API exists, the migration becomes "move UI login into a fixture" rather than "replace with API call". In that case a dedicated login-form Page and spec would be needed to cover the UI flow that is currently buried in beforeEach.

Q8: Should a dedicated UI login-form test be created?
Context: The current beforeEach exercises the login form but no test asserts on login-form behavior. qa-master discipline requires the UI login flow to be covered by exactly ONE dedicated test.
What I assumed: a login-flow spec exists elsewhere in the suite (or will be created in a separate migration). This plan does NOT create one.
Impact if wrong: the UI login flow is never E2E tested. Reviewer should decide whether to file a separate migration for the login spec.

Q9: Does a successful login automatically redirect to /dashboard?
Context: Lines 9–10: the beforeEach clicks Sign in (line 9) then immediately calls `page.goto('…/dashboard')` (line 10) without checking URL. If the app redirects, the explicit goto is redundant and may discard redirect-embedded state.
What I assumed: no automatic redirect — the explicit goto is load-bearing.
Impact if wrong: the second goto silently overwrites a meaningful redirect URL (e.g. /dashboard?token=…), which could cause the dashboard to load in a partially authenticated state.

Q10: Can "Welcome back, Jane" change? Is "Jane" a stable display name for the test account?
Context: Line 19. The migration extracts "Welcome back, Jane" to a constant or regex (EXPECTED_GREETING_PATTERN).
What I assumed: the display name is stable for the CI test account. If using a fresh API-created user (Q7), the name comes from the API call and the assertion must be dynamic (regex over the actual name, not "Jane").
Impact if wrong: any profile rename breaks the assertion with no product regression signal.
```

## Risk callouts

- **A/B variant non-determinism (HIGH):** Both the current silent pass and the proposed fix depend on the A/B variant being in a known state. If Q4 cannot confirm a fixture-controllable flag, the welcome-banner test cannot be made deterministic. Do not merge until Q4 is resolved. See pin 5.
- **Notification content dependency (HIGH):** The `'New order'` text assertion requires the test user to have a matching notification in the database. An API-created fresh user (per Q7) will have none. If the assertion cannot be backed by seeded data, it must be loosened to a presence-only check (`toBeVisible()`).
- **UI login masking auth failures:** The current `beforeEach` has no assertion that login succeeded. Any misconfigured credential in CI causes both tests to fail with a misleading "element not found" on the dashboard, not "login failed". Lifting to `authenticated.fixture.ts` surfaces auth failures at the fixture boundary where they are immediately diagnostic.
- **Redundant `goto('/dashboard')` (MEDIUM):** If login auto-redirects, the second navigation (line 10) may discard token-bearing redirect state. Review before migrating the `open()` method of `PageClassDashboard` to check whether this navigation is truly required.
- **Silent-pass pattern trains CI readers:** Green CI runs on this file currently mean "we didn't check anything" in many states. After migration, CI failures will surface real issues — CI failure rate may increase in the short term as suppressed bugs become visible. This is expected and correct.

## Expected metrics

- **Selector quality score (estimated):** 0.67 — 3 locators need DOM confirmation (LOW confidence, all proposed role-based); if all hold: 6/6 = 1.0. Conservative (3 LOW pins revert to CSS): 3/6 = 0.50.
- **Smell count delta:** −17 (2 hardcoded URLs, 2 hardcoded credentials, 1 display-name magic string, 3 CSS-class selectors, 1 index selector without comment, 2 CSS-id selectors, 1 conditional logic block, 1 try/catch swallowing failure, 2 sync probes, 2 console.log residues). +0 new smells introduced.
- **LOC delta:** source ~35 LOC → spec ~35 LOC + POM ~40 LOC + `authenticated.fixture.ts` ~25 LOC + `accounts.api.ts` ~15 LOC + test-data ~5 LOC ≈ **+85 LOC** across all new/mutated files (increase is POM + fixture additions, not the spec itself).
- **Anti-pattern coverage:** 17/17 cataloged.
