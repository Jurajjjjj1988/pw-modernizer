# Migration plan: the-internet-login.cy.js

## Source framework

cypress

The input (`inputs/cypress/the-internet-login.cy.js`) is a Cypress test using
`describe`/`it` with `cy.*` APIs targeting the public demo app
`https://the-internet.herokuapp.com`. No explicit `import` is present (Cypress
global injection model). Cypress version is not specified; usage is consistent
with Cypress 10+. Target: Playwright TypeScript (latest stable, v1.44+),
qa-master layered architecture (v0.2.0).

The file header confirms the brittleness is intentional:
> "Brittle on purpose: hard wait + id/CSS selectors + substring assertion."

---

## Summary

The test exercises the happy-path login flow on the-internet demo app: a user
fills the login form with hard-coded credentials (`tomsmith` /
`SuperSecretPassword!`), clicks the submit button, and asserts that the secure
area is reached by checking a flash success message and the presence of a
logout control. The test is deliberately short (13 LOC) but packs five distinct
anti-pattern families into one `it` block.

### What bug does this catch?

Catches a regression where submitting valid credentials on the login form fails
to authenticate and navigate the user to the secure area, or where the
post-login page omits the expected success flash message and logout option.

### User-perceivable assertion checklist

- [ ] After submitting valid credentials: the flash success message is visible
      and its text contains "You logged into a secure area"
- [ ] After submitting valid credentials: a logout control is visible with text
      containing "Logout"

---

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 5 | KB-1.1.14 | hardcoded-env-url | `cy.visit('https://the-internet.herok…')` | configure `baseURL` in playwright.config; `page.goto('/login')` relative |
| H | 6 | KB-1.1.9 | hardcoded-credential | `…type('tomsmith')` | `process.env.THE_INTERNET_USERNAME` via `.env`; never inline |
| H | 7 | KB-1.1.9 | hardcoded-credential | `…type('SuperSecretPassword!')` | `process.env.THE_INTERNET_PASSWORD` via `.env`; never inline |
| H | 8 | KB-1.2.1 | hard-wait | `cy.wait(500)` | remove entirely; Playwright auto-waits for button actionability |
| M | 6 | KB-1.2.25 | css-id-selector | `cy.get('#username')` | `page.getByLabel(/username/i)` (MED) — fallback `locator('#username')` HIGH |
| M | 7 | KB-1.2.25 | css-id-selector | `cy.get('#password')` | `page.getByLabel(/password/i)` (MED) — fallback `locator('#password')` HIGH |
| M | 9 | KB-1.2.25 | css-attr-selector | `cy.get('button[type="submit"]')` | `page.getByRole('button', { name: /login/i })` (MED) |
| M | 10 | KB-1.2.3 | css-class-selector | `cy.get('.flash.success')` | `page.locator('.flash.success')` HIGH fallback; upgrade to `getByRole('alert')` once ARIA confirmed (LOW — Q3) |
| M | 11 | KB-1.2.3 | css-class-selector | `cy.get('a.button.secondary')` | `page.getByRole('link', { name: /logout/i })` (MED) |

**Severity key:** H = test will flake / break / leak secrets. M = fragile or unreadable.

---

## Locator translation table

No DOM snapshot exists at `outputs/dom-snapshots/the-internet-login.cy.js.yaml`;
all confidence levels rely on inferred evidence from source code and standard
HTML form conventions. No `// dom-snapshot:*` annotations are emitted (none
required per step 4b when snapshot is absent).

| Original | New | Confidence | Notes |
|---|---|---|---|
| `cy.get('#username')` | `page.getByLabel(/username/i)` | med | Label association inferred from typical HTML login form (`<label for="username">`). Direct fallback `page.locator('#username')` is HIGH and should be used if Q1 is unresolved. |
| `cy.get('#password')` | `page.getByLabel(/password/i)` | med | Same inference as username. Fallback `page.locator('#password')` HIGH. |
| `cy.get('button[type="submit"]')` | `page.getByRole('button', { name: /login/i })` | med | Button role is confirmed from the `button` HTML tag. Accessible name `/login/i` is guessed from the visible button text of a standard login form; actual text unknown without DOM snapshot. Fallback `page.locator('button[type="submit"]')` HIGH. See pin 3. |
| `cy.get('.flash.success')` | `page.locator('.flash.success')` | high | Direct CSS-class mapping (per hallucination-defense rule: no role invented without ARIA evidence). Upgrade candidate: `page.getByRole('alert')` LOW — requires reviewer to confirm `role="alert"` on the element (Q3). |
| `cy.get('a.button.secondary')` | `page.getByRole('link', { name: /logout/i })` | med | Link role confirmed from `<a>` HTML tag. Accessible name `/logout/i` inferred from source assertion `.should('contain', 'Logout')`. Fallback `page.locator('a.button.secondary')` HIGH. See pin 4. |

---

## Hallucination-defense pins

1. **Username input** — assumed `page.getByLabel(/username/i)`. If DOM lacks a
   `<label for="username">` association: keep `page.locator('#username')`, add
   WHY-comment `'Q1 unresolved: label association not confirmed'`. Reviewer
   fallback: inspect the-internet login form HTML; if no label, request `<label>`
   addition or accept `locator('#username')` permanently.

2. **Password input** — assumed `page.getByLabel(/password/i)`. If DOM lacks
   `<label for="password">`: keep `page.locator('#password')`, add WHY-comment
   `'Q1 unresolved: label association not confirmed'`. Reviewer fallback: same
   as pin 1.

3. **Submit button** — assumed `page.getByRole('button', { name: /login/i })`.
   If the button's visible text is different (e.g. "Sign In" or "Submit"):
   swap the `name` regex to match; if even the role fails (e.g. it's an `<input
   type="submit">`), keep `page.locator('button[type="submit"]')`, add
   WHY-comment `'Q2 unresolved: button accessible name not confirmed'`. Reviewer
   fallback: open the-internet `/login` in a browser and inspect the button's
   accessible name via DevTools → Accessibility panel.

4. **Logout link** — assumed `page.getByRole('link', { name: /logout/i })`. If
   the element's accessible name does not contain "Logout" (e.g. it's icon-only
   or aria-labelled differently): keep `page.locator('a.button.secondary')`, add
   WHY-comment `'Q4 unresolved: logout accessible name not confirmed'`. Reviewer
   fallback: check the accessible name via DevTools → Accessibility panel on the
   `/secure` page.

---

## Structural changes

### Pages

#### `outputs/helper/page-object/pages/login.page.ts` — `PageClassLogin`

Extends `BasePage`. No own constructor. Locator fields:

| Field name | Proposed locator | Confidence |
|---|---|---|
| `inputUsername` | `page.getByLabel(/username/i)` | med |
| `inputPassword` | `page.getByLabel(/password/i)` | med |
| `buttonSubmit` | `page.getByRole('button', { name: /login/i })` | med |

Action methods:
- `open(): Promise<void>` — navigates to `LOGIN_URL` (`'/login'`) + calls `waitForPageLoad()`
- `waitForPageLoad(): Promise<void>` — web-first assertion that `buttonSubmit` is visible
- `fillCredentials(username: string, password: string): Promise<void>` — fills both inputs
- `submitLogin(): Promise<PageClassSecureArea>` — clicks submit, instantiates and returns `PageClassSecureArea` (navigation method; returns destination POM per qa-master convention)

No Block extraction: only 3 locators, well below the 5+ threshold.

Required `LABEL_LOGIN` constant in `outputs/helper/test-data/labels.ts`.

#### `outputs/helper/page-object/pages/secure-area.page.ts` — `PageClassSecureArea`

Extends `BasePage`. No own constructor. Locator fields:

| Field name | Proposed locator | Confidence |
|---|---|---|
| `flashSuccess` | `page.locator('.flash.success')` | high |
| `linkLogout` | `page.getByRole('link', { name: /logout/i })` | med |

Action methods:
- `waitForPageLoad(): Promise<void>` — web-first assertion that `flashSuccess` is visible (secure area is loaded when flash is present)
- No `open()` method needed: this page is only reached via `loginPage.submitLogin()`, never navigated to directly

Required `LABEL_SECURE_AREA` constant in `outputs/helper/test-data/labels.ts`.

URL of the secure area is unknown from source (open question Q6). The `url` field will be left as `'/secure'` (the-internet convention) pending reviewer confirmation.

### Blocks

None. Neither page reaches 5+ locators or 3+ methods.

### Fixtures

- `outputs/helper/fixtures/base.fixture.ts` (mutate) — add `loginPage: PageClassLogin` and `secureAreaPage: PageClassSecureArea` fixture injections. Both are test-scoped (touch `page`).

No additional fixture files: the test has no auth-state caching, no network mocking, and no baseline state beyond what the fresh `BrowserContext` provides.

### API wrappers

None. This IS the test that exercises the login UI flow. Per `migration-rules.md`: "Exercise each UI flow in exactly ONE test (the one that owns that behaviour)." No API-prep is needed since the test itself IS the login proof.

### Actions

None. The login → secure area journey is handled by `loginPage.submitLogin()` returning `PageClassSecureArea`. This is a POM navigation method (single-page ownership of the submit action + next-page instantiation), not a multi-POM cross-cutting journey that would warrant an `actions/` extract.

### Utilities

None. No DOM string parsing required.

### Test-data

- `outputs/helper/test-data/labels.ts` (mutate) — add `LABEL_LOGIN = "Login"` and `LABEL_SECURE_AREA = "Secure Area"`.
- `outputs/helper/test-data/urls.ts` (mutate or create) — add `LOGIN_URL = '/login'`. `SECURE_AREA_URL` deferred until Q6 is resolved.

### Types

None.

### Spec file

`outputs/tests/the-internet-login.spec.ts` — single flat `test.describe`. One test scenario (1.1 happy-path login). Tags: `@positive @e2e` (live backend, no mocking).

Credential constants sourced from env vars:
```
const VALID_USERNAME = process.env.THE_INTERNET_USERNAME!;
const VALID_PASSWORD = process.env.THE_INTERNET_PASSWORD!;
```

### Split decision

No split. Single feature, single scenario, well under the 300-LOC threshold.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/login.page.ts` | Login form controls + `submitLogin()` navigation method returning SecureAreaPage |
| Page | `outputs/helper/page-object/pages/secure-area.page.ts` | Post-login page assertions (flash, logout) |
| Block | (none) | Neither page reaches 5+ locators |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Inject `loginPage` and `secureAreaPage` fixtures |
| API | (none) | This IS the login UI test — no upstream data prep |
| Action | (none) | Login→SecureArea is a single POM nav method |
| Utility | (none) | No DOM string parsing |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | `LABEL_LOGIN`, `LABEL_SECURE_AREA` |
| Test-data | `outputs/helper/test-data/urls.ts` (mutate) | `LOGIN_URL = '/login'` |
| Type | (none) | No new external/internal shapes |
| Spec | `outputs/tests/the-internet-login.spec.ts` | The migrated test (scenario 1.1) |

---

## Open questions for reviewer

```
Q1: Do the #username and #password inputs have associated <label> elements?
Context: Lines 6–7 use `cy.get('#username')` / `cy.get('#password')` — id-based selectors.
  The proposed upgrade to `getByLabel(/username/i)` / `getByLabel(/password/i)` assumes
  `<label for="username">` / `<label for="password">` exist in the DOM.
What I assumed (if proceeding without an answer): labels are present (standard
  HTML login form on the-internet uses explicit <label> elements).
Impact if my assumption is wrong: `getByLabel` throws "locator not found"; Stage 2's
  generated PageClassLogin will break immediately on first run. Fix: swap to
  `locator('#username')` (HIGH fallback already in pins 1–2).
```

```
Q2: What is the exact visible text or aria-label of the submit button?
Context: Line 9 uses `cy.get('button[type="submit"]')` — tag+attribute selector giving
  no accessible-name evidence. The proposed target `getByRole('button', { name: /login/i })`
  guesses "Login" from form context.
What I assumed (if proceeding without an answer): button text is /login/i (case-insensitive).
Impact if my assumption is wrong: `getByRole('button', { name: /login/i })` resolves to zero
  elements if the button reads "Sign In", "Submit", or similar. Fix: adjust regex in pin 3;
  fallback `locator('button[type="submit"]')` is always safe.
```

```
Q3: Does the .flash.success element carry role="alert" in the-internet DOM?
Context: Line 10 uses `cy.get('.flash.success')` — CSS class, no ARIA signal.
  The ARIA upgrade to `getByRole('alert')` is listed as LOW confidence and gated on this answer.
What I assumed (if proceeding without an answer): NO role="alert" (staying with
  `locator('.flash.success')` HIGH in the primary plan).
Impact if my assumption is wrong: if role IS "alert", keeping the CSS selector is valid but
  misses the opportunity to use the more resilient semantic locator. Not a breakage — just
  a locator-quality miss.
```

```
Q4: What is the full accessible name of the a.button.secondary logout element?
Context: Line 11 uses `cy.get('a.button.secondary').should('contain', 'Logout')`.
  The source assertion confirms text contains "Logout" but does not confirm the accessible
  name (which may differ if aria-label or aria-labelledby overrides it).
What I assumed (if proceeding without an answer): accessible name contains "Logout"
  (text content matches aria name — no aria-label override).
Impact if my assumption is wrong: `getByRole('link', { name: /logout/i })` matches zero
  elements. Fix: swap name regex to match actual aria name; fallback `locator('a.button.secondary')`.
```

```
Q5: Should a negative login test (invalid credentials → error message) be added to the spec?
Context: The source covers only the happy path. The-internet shows distinct error messages
  for invalid username ("Your username is invalid!") and invalid password ("Your password
  is invalid!"). Neither is tested.
What I assumed (if proceeding without an answer): The migration reproduces source behavior
  only (one happy-path scenario). Adding negative coverage is the reviewer's call.
Impact if my assumption is wrong: a coverage gap remains. Recommend adding scenario 1.2
  (invalid credentials → flash error message) in a follow-up spec or in the same file.
```

```
Q6: What is the URL of the secure area page after login?
Context: The source test verifies secure area content but never asserts on the URL.
  PageClassSecureArea.url needs a value for potential `open()` methods or URL assertions.
What I assumed (if proceeding without an answer): `'/secure'` (the-internet's known
  post-login route based on public documentation of the demo app).
Impact if my assumption is wrong: `waitForURL('/secure')` or any URL assertion would fail.
  Since the plan does not add a URL assertion, impact is low for now but would surface
  if Stage 2 adds `waitForPageLoad` with `toHaveURL`.
```

```
Q7: Should credentials stay as env vars or can they be named constants?
Context: `tomsmith` / `SuperSecretPassword!` are publicly documented credentials for
  the-internet. They are not secret. However, KB-1.1.9 categorizes hardcoded credentials
  as a security smell regardless of whether the credentials are "public".
What I assumed (if proceeding without an answer): env vars (`THE_INTERNET_USERNAME`,
  `THE_INTERNET_PASSWORD`) per KB-1.1.9 policy. Stage 2 emits `process.env.THE_INTERNET_USERNAME!`.
Impact if my assumption is wrong: if reviewer approves named constants instead
  (`const VALID_USERNAME = 'tomsmith'`), Stage 2 must be re-prompted to use constants
  instead of env-var access. The stage-2 generated code MUST NOT hardcode them inline.
```

```
Q8: Should this test run against a live backend or a mocked/stubbed version?
Context: The test targets `https://the-internet.herokuapp.com` — a live public demo.
  The migration removes the hardcoded URL (KB-1.1.14) and substitutes `baseURL` config.
  If CI sets `BASE_URL=https://the-internet.herokuapp.com`, the test exercises the real app.
  If CI uses a stub, network mocking would be needed.
What I assumed (if proceeding without an answer): live backend (no mocking). Tags: @e2e.
Impact if my assumption is wrong: a mock fixture for the login endpoint and the secure-area
  response would need to be extracted to `base.fixture.ts` or a dedicated
  `helper/fixtures/the-internet-mocks.fixture.ts`. This is a significant structural change.
```

---

## Risk callouts

- **Live public SUT dependency.** The test targets a third-party demo app
  (`https://the-internet.herokuapp.com`). If the app is down, CI fails with a
  network error rather than an actionable test failure. Recommend: set
  `BASE_URL` to the live host in CI and document the dependency in the repo's
  "Test environment" section; consider adding a `global-setup` health check
  per KB-1.2.38.

- **Hard wait removal revealing latency.** The `cy.wait(500)` (line 8) was
  added between form fill and button click. After removal, Playwright's
  auto-wait handles button actionability — this is correct behavior. However,
  if the submit button is briefly disabled while JavaScript initializes on
  the-internet, Playwright's `actionTimeout: 5_000` will catch it. The wait
  removal may surface a real latency the source was papering over.

- **Flash message race on navigation.** The `.flash.success` assertion fires
  immediately after the button click. In Playwright, `loginPage.submitLogin()`
  returns `PageClassSecureArea` whose `waitForPageLoad()` must assert the flash
  is visible before the spec can proceed. If `waitForPageLoad()` is implemented
  as `await expect(this.flashSuccess).toBeVisible()` this is handled correctly.
  If it uses `waitForLoadState('networkidle')` (a KB-1.1.16 violation), the
  assertion may race.

- **No negative path coverage.** The source has no test for invalid credentials
  (wrong username / wrong password). The migration preserves this coverage gap.
  The-internet shows a flash error message for failed logins; a missing negative
  test is a quality gap, not a bug in the migration itself.

- **Parallel worker credential collision.** If multiple Playwright workers run
  this test in parallel using the same `tomsmith` credentials against a live
  stateful backend, session state could collide. The-internet is stateless
  enough that this is unlikely, but worth noting if the SUT is later swapped
  for a real app with rate-limiting on repeated login.

---

## Expected metrics

- **Selector quality score (estimated post-migration):** 0.80 (4/5 locators
  are role/label-based — username `getByLabel`, password `getByLabel`, button
  `getByRole`, logout `getByRole`; flash message stays as `locator('.flash.success')`
  pending ARIA confirmation)
- **Smell count delta vs source:** −9 (4 H-severity: 1 hardcoded URL + 2
  hardcoded credentials + 1 hard wait; 5 M-severity: 3 CSS selectors upgraded
  + 2 CSS class selectors upgraded)
- **LOC delta:** +102 estimated (source 13 LOC → target: spec ~45 LOC +
  login.page.ts ~40 LOC + secure-area.page.ts ~30 LOC = ~115 LOC total across
  new files; net +102)
- **Anti-pattern coverage:** 9/9
