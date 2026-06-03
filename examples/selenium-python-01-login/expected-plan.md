# Migration plan: input.spec.ts (Selenium Python -> Playwright TypeScript)

## Source framework
selenium-python

## Summary
Beacon HR sign-in and dashboard KPI. Two scenarios: a valid credential
pair signs the user in and shows a personalised greeting on the
dashboard; once signed in, the "Team members" KPI card shows a non-zero
integer count.

## Anti-patterns detected

Sorted by Severity (H, M, L), then by Line.

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 13 | KB-1.4.16 | implicit-wait-global | `drv.implicitly_wait(5)` | drop; web-first auto-retry covers it |
| H | 25 | KB-1.4.1 | hard-wait | `time.sleep(2)` | drop; web-first assertion |
| H | 34-36 | KB-1.4.4 | webdriverwait-ceremony | `EC.visibility_of_element_located(...)` | `await expect(locator).toBeVisible()` |
| H | 23,32 | KB-1.4.2 | xpath-deep | `//form//button[@type='submit']` | `getByRole('button', { name: 'Sign in' })` |
| M | 45 | KB-1.4.17 | snapshot-list-indexing | `cards[0]` | pick by accessible name (`getByRole('region', { name: 'Team members' })`) |
| M | 39 | KB-1.4.13 | non-web-first-text-equality | `assert greeting == "Welcome back, HR Admin"` | `await expect(loc).toBeVisible()` (visible text) |
| M | 46 | KB-1.4.13 | non-web-first-text-equality | `assert int(count) >= 1` | `await expect(loc).toHaveText(/^\d+$/)` + `not.toHaveText('0')` |
| M | 11-15 | KB-1.4.5 | driver-fixture-boilerplate | `def driver(): drv = webdriver.Chrome(); ...` | `page` fixture (built-in) |
| M | 18-25 | KB-1.4.5 | implicit-fixture-dependency | `def logged_in_driver(driver): ...` | Playwright fixture with explicit destructuring |
| L | 38,45 | KB-1.4.3 | css-class-selector | `.dashboard-greeting`, `.kpi-card` | role-based locators |

## Locator translation table
| Original | New | Confidence | Notes |
|---|---|---|---|
| `By.ID, "email"` | `page.getByLabel('Email')` | medium | Assumes a `<label>` association. If placeholder-only, `getByPlaceholder('Email')`. |
| `By.ID, "password"` | `page.getByLabel('Password')` | medium | Same. |
| `By.XPATH, "//form//button[@type='submit']"` | `page.getByRole('button', { name: 'Sign in' })` | high | The form's submit button is the Sign in CTA. |
| `By.CSS_SELECTOR, ".dashboard-greeting"` | `page.getByRole('heading', { name: 'Welcome back, HR Admin' })` | medium | Assumes the greeting is a heading. If just a styled `<div>`, fall back to `page.getByText('Welcome back, HR Admin')`. |
| `By.CSS_SELECTOR, ".kpi-card"` (first) | `page.getByRole('region', { name: 'Team members' })` | low | Original tests pick `cards[0]` and assumes it is the Team card. Migrated test picks BY NAME (more robust) but assumes the card has an accessible name. If not, fall back to `page.getByTestId('kpi-team').first()`. |
| `By.CSS_SELECTOR, ".kpi-value"` (inside team card) | `teamCard.getByTestId('kpi-value')` | medium | KPI values are commonly testid-tagged; reviewer should confirm. |

## Hallucination-defense pins

1. **Email input** — assumed `page.getByLabel('Email')`. If the input lacks a `<label>`: keep `By.ID, "email"` → `page.locator('#email')`, add WHY-comment `'Q-email unresolved: Email label association'`. Reviewer fallback: ask FE team to add `<label for="email">Email</label>` OR switch to `page.getByPlaceholder('Email')`.
2. **Password input** — assumed `page.getByLabel('Password')`. If the input lacks a `<label>`: keep `page.locator('#password')`, add WHY-comment `'Q-password unresolved: Password label association'`. Reviewer fallback: ask FE team for a `<label>` OR use `page.getByPlaceholder('Password')`.
3. **Dashboard greeting** — assumed `page.getByRole('heading', { name: 'Welcome back, HR Admin' })`. If the greeting is a styled `<div>` rather than a heading: keep `By.CSS_SELECTOR, ".dashboard-greeting"` → `page.locator('.dashboard-greeting')`, add WHY-comment `'Q-greeting unresolved: heading semantics'`. Reviewer fallback: ask FE team to wrap the greeting in `<h1>`/`<h2>`, OR use `page.getByText('Welcome back, HR Admin')`.
4. **Team members KPI card** — assumed `page.getByRole('region', { name: 'Team members' })`. If the card has no accessible name or is just a styled `<div>`: keep positional `.kpi-card` first-of-type, add WHY-comment `'Q-kpi-card unresolved: accessible name on card'`. Reviewer fallback: ask FE team to add `aria-labelledby` referencing the card title, OR use `page.getByTestId('kpi-team')`.
5. **KPI value (inside team card)** — assumed `teamCard.getByTestId('kpi-value')`. If no `data-testid` is present: keep `By.CSS_SELECTOR, ".kpi-value"` scoped under the team card, add WHY-comment `'Q-kpi-value unresolved: testid presence'`. Reviewer fallback: ask FE team to add `data-testid="kpi-value"` on the metric, OR scope by role (`teamCard.getByRole('text')` is unreliable; prefer testid).

## Structural changes
- Extract POM: no — only two short tests, both highly readable inline.
- Extract fixture: YES — `loggedInPage` fixture replaces the implicit
  `logged_in_driver` pytest fixture. Login is performed via the UI (to
  keep parity with the source); for stable CI we could switch to a
  `storageState` fixture in a follow-up.
- Split into multiple specs: no.

## Open questions for reviewer
- **Q-email** / **Q-password**: Do the Email and Password inputs have associated `<label>` elements (`<label for="email">`)? If only placeholders, switch `getByLabel` → `getByPlaceholder` in the migration.
- **Q-greeting**: Is the dashboard greeting rendered as a heading element (`<h1>`/`<h2>`), or just styled text in a `<div>`? Determines whether to upgrade locator OR keep CSS class.
- **Q-kpi-card**: Is the "Team members" KPI card the FIRST card in the layout, or just one of several? The original test relies on `cards[0]` (positional); the migrated test relies on the card's accessible name. If the card has no accessible name, switch to `getByTestId('kpi-team')`.
- **Q-kpi-value**: Does the team KPI value element have a `data-testid="kpi-value"` attribute? Without it, the scoped CSS selector is the only reliable target.
- Does the team KPI value show "0" when there are no team members, or does the API guarantee at least one? The assertion `not.toHaveText('0')` guards against the empty case — keep or drop based on intent.
- Currently the `loggedInPage` fixture logs in through the UI. If login is well-covered elsewhere, switch to a `storageState`-based fixture to halve runtime and reduce login-step noise.

## Risk callouts
- Auth via UI in a fixture: if the login page changes (selector,
  greeting copy), every test using `loggedInPage` will fail. This is the
  right level of coupling for v0; revisit when the suite grows.
- `not.toHaveText('0')` is a narrow guard — it lets "0 " (with a
  trailing space) through. Reviewer should confirm whether trim
  semantics matter.

## Expected metrics
- Selector quality score: 5/5 role/label-based + 1 testid (was 0/6
  id / xpath / css).
- Smell count delta: -1 `time.sleep`, -1 implicit wait, -1
  `WebDriverWait`, -1 snapshot-list indexing, -2 non-web-first
  assertions, -1 implicit fixture dependency.
- LOC delta: 47 → 39 (-8 lines).
