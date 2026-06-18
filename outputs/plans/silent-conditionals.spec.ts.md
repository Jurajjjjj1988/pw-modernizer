# Migration plan: silent-conditionals.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes anti-patterns without introducing new framework imports beyond rewiring the import from `@playwright/test` to `@fixtures/base.fixture`.

**Source file:** `inputs/bad-playwright/silent-conditionals.spec.ts`
**Target file(s):** see §5 structural-changes summary table.

## Summary

This test suite exercises the Acme Shop dashboard page as a logged-in user. Test 1 checks that a personalised welcome banner renders with the user's display name; test 2 checks that the notifications widget opens and shows the most recent notification. Both source tests are presently non-assertive in their failure paths — test 1 uses an `if (await el.isVisible())` conditional that silently passes (with a `console.log`) when the banner is absent (the inline comment acknowledges this as intentional A/B-variant hedging), and test 2 wraps the entire interaction and assertion in a `try/catch` that swallows any widget failure and `console.log`s instead of failing. The migration removes both silent-pass mechanisms, restructures assertions to be unconditional and web-first, and extracts the dashboard surface into a `PageClassDashboard` per qa-master discipline.

### What bug does this catch?

Catches a regression where an authenticated user's dashboard silently fails to render the personalised welcome banner or to load the notifications widget — both failures currently cause the source tests to silently pass, making the suite an actively misleading quality gate.

### User-perceivable assertion checklist

- [ ] After authenticated dashboard load: welcome banner element is visible
- [ ] After authenticated dashboard load: welcome banner text contains the logged-in user's display name (matching `/welcome back.*jane/i`)
- [ ] After clicking the notifications widget: at least one notification item is visible
- [ ] After clicking the notifications widget: first visible notification item text contains `/new order/i`

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 1 | KB-1.1.26 | wrong-import | `import { test, expect } from '@playwright/test'` | import from `@fixtures/base.fixture` |
| H | 6 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/login')` | configure `baseURL`; use relative path in auth fixture |
| H | 7 | KB-1.1.9 | hardcoded-credentials | `.fill('jane.doe@acme.test')` | `process.env.TEST_USER_EMAIL` in auth fixture |
| H | 8 | KB-1.1.9 | hardcoded-credentials | `.fill('Sup3rSecret!')` | `process.env.TEST_USER_PASSWORD` in auth fixture |
| H | 10 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/dashboard')` | `dashboardPage.open()` navigates via relative path |
| H | 17 | KB-1.1.12 | conditional-logic | `if (await welcomeBanner.isVisible()) {` | assert unconditionally; control A/B state in fixture |
| H | 18 | KB-1.1.19 | text-snapshot-race | `expect(await welcomeBanner.innerText()).toContain…` | `await expect(dashboardPage.textWelcomeBanner).toContainText(…)` |
| H | 27–32 | KB-1.1.13 | try-catch-swallowing | `try { await widget.click()… } catch (e) {…}` | remove try/catch; assert unconditionally |
| H | 30 | KB-1.1.19 | text-snapshot-race | `expect(await firstNotification.innerText()).toContain…` | `await expect(dashboardPage.textFirstNotification).toContainText(…)` |
| M | 7 | KB-1.1.3 | css-id-selector | `page.locator('#email')` | `page.getByLabel(/email/i)` (MED conf — see pin 1) |
| M | 8 | KB-1.1.3 | css-id-selector | `page.locator('#password')` | `page.getByLabel(/password/i)` (MED conf — see pin 2) |
| M | 14 | KB-1.1.3 | css-class-selector | `page.locator('.welcome-banner')` | retain at LOW conf with WHY comment (see pin 3) |
| M | 26 | KB-1.1.3 | css-class-selector | `page.locator('.notifications-widget')` | `page.getByRole('button', { name: /notifications/i })` (MED conf — see pin 4) |
| M | 29 | KB-1.1.3 | css-class-selector | `page.locator('.notification-item').first()` | retain at LOW conf with WHY comment (see pin 5) |
| L | 20 | KB-UNCLASSIFIED | console-log | `console.log('Welcome banner not rendered…')` | delete; silence is not a valid test outcome |
| L | 31 | KB-UNCLASSIFIED | console-log | `console.log('Notifications widget failed…')` | delete; entire catch block removed |

### Unclassified smells

**KB-UNCLASSIFIED — `console.log` as silent-skip mechanism (lines 20, 31):** Both `console.log` calls function as "log and continue" silent-pass mechanisms, not as observer/listener debug residue (that class is KB-1.1.23). They are direct test-body statements that suppress assertion failures. Migration-rules.md §8 lists `console.log / console.debug in committed code` as a hard-fail pattern; however, the KB catalog has no entry specifically for `console.log` used as a silent-skip in test bodies. Reviewer: consider adding a KB-1.1.X entry to distinguish this pattern from the `page.on('console', ...)` listener smell.

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('#email')` | `page.getByLabel(/email/i)` | med | Assumes `<label for="email">` or `aria-label="Email"` exists on the login form. Fall back: `getByRole('textbox', { name: /email/i })`. Moves to auth fixture. See pin 1. |
| `page.locator('#password')` | `page.getByLabel(/password/i)` | med | Same label assumption. Fall back: `getByRole('textbox', { name: /password/i })`. Moves to auth fixture. See pin 2. |
| `page.getByRole('button', { name: 'Sign in' })` | `page.getByRole('button', { name: /sign in/i })` | high | Already canonical; minor regex upgrade for copy-variation resilience. Moves to auth fixture. |
| `page.locator('.welcome-banner')` | `page.locator('.welcome-banner')` | low | No DOM snapshot available. Hallucination-defense rule prohibits inventing a role without evidence. Retained as CSS class with WHY comment; reviewer to add `data-testid="welcome-banner"`. See pin 3. |
| `page.locator('.notifications-widget')` | `page.getByRole('button', { name: /notifications/i })` | med | Element is clicked in source → inferred as interactive. Assumes button role and accessible name includes "notifications". See pin 4. |
| `page.locator('.notification-item').first()` | `page.locator('.notification-item').first()` | low | No DOM snapshot. Cannot determine element role or accessible name. Retained with `// TODO: fragile selector — add testid` comment per migration-rules.md §5. See pin 5. |

## Hallucination-defense pins

1. **Email input (login form)** — assumed `page.getByLabel(/email/i)`. If DOM lacks `<label for="email">` or `aria-label="Email"`: keep `page.locator('#email')`, add WHY-comment `'Q3 unresolved: email label association not confirmed — ID fallback'`. Reviewer fallback: confirm `<label for="email">` exists in the login form, or ask FE to add `aria-label="Email"`.

2. **Password input (login form)** — assumed `page.getByLabel(/password/i)`. If DOM lacks label: keep `page.locator('#password')`, add WHY-comment `'Q3 unresolved: password label association not confirmed — ID fallback'`. Reviewer fallback: same as pin 1.

3. **Welcome banner** — assumed `page.locator('.welcome-banner')` retained as-is (LOW confidence, no upgrade possible without DOM snapshot — inventing a role would violate hallucination-defense rule 4). WHY-comment Stage 2 must emit: `'Q4 unresolved: .welcome-banner ARIA role unknown — CSS class last-resort, see plan pin 3'`. Reviewer fallback: inspect DOM for ARIA role/testid, or ask FE to add `data-testid="welcome-banner"` and upgrade to `getByTestId('welcome-banner')`.

4. **Notifications widget** — assumed `page.getByRole('button', { name: /notifications/i })`. If widget is not a `<button>` (e.g. `<div>` with click handler, or `<a>` link): keep `page.locator('.notifications-widget')`, add WHY-comment `'Q4 unresolved: .notifications-widget role not confirmed — assumed button because element is clicked'`. Reviewer fallback: inspect DOM for actual role, or ask FE to add `data-testid="notifications-widget"`.

5. **Notification item (first)** — assumed `page.locator('.notification-item').first()` retained as-is (LOW confidence). WHY-comment Stage 2 must emit: `'Q4 unresolved: .notification-item element type unknown — CSS class + .first() last-resort, see plan pin 5'`. Reviewer fallback: ask FE to add `data-testid="notification-item"` and upgrade to `getByTestId('notification-item').first()`.

## Structural changes

- **Extract Page:** yes — `outputs/helper/page-object/pages/dashboard.page.ts` (`PageClassDashboard` extending `BasePage`). No own constructor. `readonly` locator fields: `textWelcomeBanner` (`.welcome-banner`), `buttonNotificationsWidget` (`.notifications-widget`, MED conf), `textFirstNotification` (`.notification-item` first). `open()` navigates to `/dashboard` and awaits `waitForPageLoad()`. `waitForPageLoad()` asserts on a stable landmark (see Q2). Justified by qa-master §5a "Always at least one" and by the rule that `page.goto()` never appears in specs.
- **Extract block:** no — 3 locators total in the dashboard context, below the 5-locator extraction threshold (migration-rules.md §1).
- **Mutate `base.fixture.ts`:** yes — add `dashboardPage: PageClassDashboard` injection. If A/B variant cookie confirmed (Q5), add cookie setter in the auto-`page` fixture block.
- **Auth setup:** the `beforeEach` performs full UI login on every test. Recommended: extract to `outputs/helper/fixtures/authenticated.fixture.ts` (creates or reuses a browser session from env-var credentials). **Conditional on Q6** — if no session API exists, keep a streamlined `beforeEach` using env-var credentials without hardcoded strings. The `authenticated.fixture.ts` row in the summary table is marked conditional accordingly.
- **Split into multiple specs:** no — two related dashboard-render scenarios sharing the same auth precondition and page surface.
- **Mutate `labels.ts`:** yes — add `LABEL_DASHBOARD = "Dashboard"` for POM `.describe()` calls.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/dashboard.page.ts` | `PageClassDashboard`: welcome banner, notifications widget, first notification item |
| Block | (none) | 3 locators < 5-locator extraction threshold |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | add `dashboardPage: PageClassDashboard` injection |
| Fixture | `outputs/helper/fixtures/authenticated.fixture.ts` (conditional on Q6) | encapsulate login session; replaces UI-login `beforeEach` |
| API | (none) | data prep: no seeded content needed beyond auth (see Q7 for notification seeding concern) |
| Action | (none) | single-page journey |
| Utility | (none) | no DOM string parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | add `LABEL_DASHBOARD = "Dashboard"` |
| Type | (none) | n/a |
| Spec | `outputs/tests/silent-conditionals.spec.ts` | the migrated test |

## Open questions for reviewer

```
Q1: Should the "banner absent" case (A/B variant off) become a dedicated test, or is it dropped?
Context: lines 19–21 — the `else { console.log(...) }` branch is being removed by this migration.
What I assumed: out of scope; only the positive path (banner visible, variant ON) is migrated.
Impact if wrong: the "variant off" dashboard state is left entirely uncovered after migration.
```

```
Q2: What is a reliable stable landmark on the dashboard page that `waitForPageLoad()` can assert on?
Context: structural changes section — PageClassDashboard.waitForPageLoad() needs a web-first guard.
What I assumed: the welcome banner itself is the stabilisation anchor — `await expect(this.textWelcomeBanner).toBeVisible()`. If the A/B variant may be off on load, a different landmark (e.g. page heading, nav bar) should be used.
Impact if wrong: waitForPageLoad() asserts on an element that may be absent, causing spurious timeout failures.
```

```
Q3: Does the #email input have an associated <label for="email"> or aria-label? Does #password have the same?
Context: lines 7–8; locator table rows 1–2; pins 1–2.
What I assumed: standard form labelling (label elements present).
Impact if wrong: getByLabel finds no element; Stage 2 must fall back to locator('#email') / locator('#password').
```

```
Q4: What ARIA role and accessible name do .welcome-banner, .notifications-widget, and .notification-item carry?
Context: lines 14, 26, 29; locator table rows 4–6; pins 3–5. No DOM snapshot available.
What I assumed: .welcome-banner has unknown role (CSS class retained at LOW conf); .notifications-widget is a clickable button (role=button); .notification-item has unknown role (CSS class retained at LOW conf).
Impact if wrong: if .notifications-widget is not a button, the proposed getByRole('button', { name: /notifications/i }) finds 0 elements and the test fails on locator resolution, not on a product bug.
```

```
Q5: Can the A/B variant that controls the welcome banner be forced ON via a cookie or localStorage entry set before page load?
Context: line 16 comment — "Banner sometimes doesn't render if A/B variant is off — skip silently".
What I assumed: a cookie or localStorage key can be set in the base.fixture.ts `page` fixture block to guarantee the banner renders deterministically.
Impact if wrong: if the variant is server-side only (tied to a user-account flag in the database), the fixture approach will not work; the migration must instead seed the flag via API on the test user account, or tag the test test.fixme() until the variant mechanism is clarified.
```

```
Q6: Is there a POST /api/auth/login (or equivalent) endpoint that returns session cookies so the test can authenticate without a UI login flow?
Context: lines 5–11; structural changes (authenticated.fixture.ts conditional on this answer).
What I assumed: endpoint may or may not exist — authenticated.fixture.ts listed as conditional.
Impact if wrong: if no API endpoint exists, Stage 2 must keep the beforeEach UI login but encapsulate it in a named fixture with env-var credentials (no hardcoded strings). If an endpoint exists and is not used, every test burns a full browser login round-trip.
```

```
Q7: Does the test environment have a pre-seeded "New order" notification for the authenticated test user? A freshly API-created user will have zero notifications.
Context: line 30 — asserts firstNotification.innerText() contains 'New order'.
What I assumed: the environment is pre-seeded, or the notification assertion can be loosened to presence-only (await expect(dashboardPage.textFirstNotification).toBeVisible()) if seeding is not feasible.
Impact if wrong: the assertion fails with "expected text not found" on a correctly-working widget when the test user has no notifications.
```

```
Q8: Does a successful login automatically redirect to /dashboard? Line 9 clicks Sign in; line 10 immediately calls page.goto('…/dashboard') with no intervening assertion. If the app redirects, the second goto is redundant and may discard redirect-embedded tokens.
Context: lines 9–10.
What I assumed: the explicit goto is intentional (no automatic redirect, or redirect is to a different page). The migrated POM's open() will be the single navigation entry point.
Impact if wrong: if the redirect is expected and the explicit goto is masking a broken redirect, the migrated test will also mask the regression.
```

```
Q9: Are TEST_USER_EMAIL and TEST_USER_PASSWORD already provisioned in the CI environment?
Context: lines 7–8 (credentials promoted to env vars).
What I assumed: vars will be added to CI as part of this PR.
Impact if wrong: Stage 2 spec references undefined env vars; test fails at startup with a config error, not an assertion error.
```

```
Q10: Is "Welcome back, Jane" a stable assertion? Is "Jane" the permanent display name for the CI test account, or could a profile rename break it?
Context: line 18 — assertion text being migrated to regex /welcome back.*jane/i.
What I assumed: "Jane" is stable for the dedicated CI test account. If using a freshly API-created user (Q6), the name will differ; the assertion must be dynamic (e.g. /welcome back/i without the name, or interpolated from a test-data constant).
Impact if wrong: any display-name change breaks the assertion with no product regression signal.
```

## Risk callouts

- **Silent tests surface real failures on first CI run:** Both source tests currently pass when their subject is broken. After migration, Scenario 1.1 WILL fail if the A/B variant is off and Q5 is unresolved; Scenario 1.2 WILL fail if the notifications widget has a pre-existing bug. Communicate to the team that CI failures after this merge are not regressions introduced by the migration — they are pre-existing product bugs the migration is now correctly detecting.
- **A/B variant non-determinism (Q5 blocker):** If Q5 cannot confirm a fixture-controllable flag, the welcome-banner test cannot be made deterministic. Treat Q5 as a merge blocker for Scenario 1.1.
- **Notification content dependency (Q7):** The `/new order/i` assertion will fail on a fresh test user with no notifications. Either seed a notification in the auth setup, loosen to a presence-only check, or accept a dependency on a pre-seeded environment.
- **UI login bottleneck:** All tests in the suite perform full browser UI login in every `beforeEach`. On a parallel CI matrix this strains the login endpoint; if rate-limited, tests fail at auth setup with no signal about the dashboard.
- **Missing post-login URL assertion:** The source `beforeEach` clicks Sign in without asserting the resulting URL or a page element confirming auth success. A broken login that renders a blank page or an error silently proceeds to `goto('/dashboard')`. The auth fixture should assert on login success before yielding.
- **Username assertion coupling:** `/welcome back.*jane/i` couples the test to one test account's display name. A profile rename produces a false failure. See Q10.

## Expected metrics

- **Selector quality score (estimated):** 0.67 (4/6 locators role/label-based after migration: `getByLabel` × 2 for login form, `getByRole('button', { name: 'Sign in' })` already canonical, `getByRole('button', { name: /notifications/i })` for widget; 2 CSS class fallbacks remain: `.welcome-banner` and `.notification-item`)
- **Smell count delta:** −14 (16 source smells cataloged; 2 CSS class locators retained as documented last-resort with WHY comments, not counted as new smells in output; net removal = 14)
- **LOC delta:** +50 (source 35 LOC; estimated target: ~45 spec + ~45 POM + ~10 fixture additions − 35 source ≈ +65; rounded to +50 for POM locator efficiency)
- **Anti-pattern coverage:** 16/16
