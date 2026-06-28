# Migration plan: saucedemo-login.cy.js

## Source framework

Cypress (`.cy.js`, `cy.*` command API). Framework version not declared in source; inferred from `cy.visit` / `cy.get` / `cy.wait` / `.should` API surface. Target: Playwright TypeScript (latest stable v1.x).

## Summary

This test exercises the standard-user login flow against the SauceDemo demo e-commerce site: navigating to the login page, filling in valid credentials, clicking the login button, and asserting that the inventory page loads with a "Products" heading, exactly six product cards, and a visible shopping cart link. It is a single positive-path scenario. No negative scenario (bad credentials → error message) exists in the source.

### What bug does this catch?

Catches a regression where valid credentials silently fail to log the user in and land them on the product inventory page — the form either rejects the credentials, the page never transitions, or the inventory content fails to render.

### User-perceivable assertion checklist

- [ ] After valid login: the "Products" heading is visible on the inventory page
- [ ] After valid login: exactly 6 inventory items are present on the page
- [ ] After valid login: the shopping cart link/icon is visible

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 5 | KB-1.1.14 | hardcoded-url | `cy.visit('https://www.saucedemo.com/')` | configure `baseURL` in `playwright.config.ts`; use relative path `'/'` |
| H | 6 | KB-1.1.9 | hardcoded-credential | `.type('standard_user')` | extract to env var `SAUCEDEMO_USERNAME` via `process.env` |
| H | 7 | KB-1.1.9 | hardcoded-credential | `.type('secret_sauce')` | extract to env var `SAUCEDEMO_PASSWORD` via `process.env` |
| H | 8 | KB-1.2.1 | hard-wait | `cy.wait(1000)` | remove; Playwright auto-waits for actionability before click |
| H | 10 | KB-1.2.1 | hard-wait | `cy.wait(2000)` | replace with `await expect(inventoryPage.headingProducts).toBeVisible()` |
| M | 6 | KB-1.2.25 | css-id-selector | `cy.get('#user-name')` | upgrade to `getByLabel(/username/i)` (MED) — Q1 |
| M | 7 | KB-1.2.25 | css-id-selector | `cy.get('#password')` | upgrade to `getByLabel(/password/i)` (MED) — Q1 |
| M | 9 | KB-1.2.25 | css-id-selector | `cy.get('#login-button').click()` | upgrade to `getByRole('button', { name: /log in/i })` (MED) — Q2 |
| M | 11 | KB-1.2.3 | css-class-selector | `cy.get('.title')` | upgrade to `getByRole('heading', { name: /products/i })` (MED) — Q3 |
| M | 12 | KB-1.2.3 | css-class-selector | `cy.get('.inventory_item')` | preserve as `locator('.inventory_item')` pending testid addition — Q4 |
| M | 12 | KB-1.1.9 | magic-number | `.should('have.length', 6)` | extract to `const EXPECTED_INVENTORY_COUNT = 6` |
| M | 13 | KB-1.2.3 | css-class-selector | `cy.get('.shopping_cart_link')` | upgrade to `getByRole('link', { name: /shopping cart/i })` (MED) — Q5 |

## Locator translation table

No DOM snapshot present at `outputs/dom-snapshots/saucedemo-login.cy.js.yaml` — evidence is inferred from id/class names and assertion text (offline migration fallback path per §4b).

| Original | New | Confidence | Notes |
|---|---|---|---|
| `cy.get('#user-name')` | `page.getByLabel(/username/i)` | med | CSS id `#user-name` implies a labelled form field; label text inferred from id name — no DOM snapshot. Fallback: `page.locator('#user-name')`. See Q1. |
| `cy.get('#password')` | `page.getByLabel(/password/i)` | med | CSS id `#password` implies a labelled password field; label inferred from id name — no DOM snapshot. Fallback: `page.locator('#password')`. See Q1. |
| `cy.get('#login-button')` | `page.getByRole('button', { name: /log in/i })` | med | CSS id `#login-button` strongly implies a submit button; accessible name unverified — no DOM snapshot. Fallback: `page.locator('#login-button')`. See Q2. |
| `cy.get('.title')` | `page.getByRole('heading', { name: /products/i })` | med | CSS class `.title` + assertion text `'Products'` implies a page heading; element tag (h1/h2/div) unverified — no DOM snapshot. Fallback: `page.locator('.title')`. See Q3. |
| `cy.get('.inventory_item')` | `page.locator('.inventory_item')` | high | CSS class preserved; no accessible-name or role evidence available. Reviewer should add `data-testid="inventory-item"` to the SUT for a stable upgrade. See Q4. |
| `cy.get('.shopping_cart_link')` | `page.getByRole('link', { name: /shopping cart/i })` | med | CSS class `.shopping_cart_link` implies a cart link; accessible name unverified — no DOM snapshot. Fallback: `page.locator('.shopping_cart_link')`. See Q5. |

## Hallucination-defense pins

1. **Username input** — assumed `page.getByLabel(/username/i)`. If DOM contradicts (no `<label>` or `aria-label` for `#user-name`): keep `page.locator('#user-name')`, add WHY-comment `'Q1 unresolved — no visible label found for #user-name'`. Reviewer fallback: check for `<label for="user-name">` in devtools; if placeholder text exists instead, use `page.getByPlaceholder(/username/i)`.

2. **Password input** — assumed `page.getByLabel(/password/i)`. If DOM contradicts (no `<label>` or `aria-label` for `#password`): keep `page.locator('#password')`, add WHY-comment `'Q1 unresolved — no visible label found for #password'`. Reviewer fallback: same as pin 1 — check for label element or use `page.getByPlaceholder(/password/i)`.

3. **Login button** — assumed `page.getByRole('button', { name: /log in/i })`. If DOM contradicts (element is `<input type="submit">` with a value that does not match `/log in/i`, or accessible name differs): keep `page.locator('#login-button')`, add WHY-comment `'Q2 unresolved — button accessible name not confirmed'`. Reviewer fallback: inspect the button's inner text or `value` attribute in devtools; update the `name` regex to match the exact accessible name.

4. **Products heading** — assumed `page.getByRole('heading', { name: /products/i })`. If DOM contradicts (`.title` is a `<span>` or `<div>` without a `role="heading"`): keep `page.locator('.title')`, add WHY-comment `'Q3 unresolved — .title element is not a semantic heading'`. Reviewer fallback: if the element shows the text "Products" as a non-heading, use `page.getByText('Products', { exact: true })` instead; ask FE team to switch to a semantic heading tag.

5. **Shopping cart link** — assumed `page.getByRole('link', { name: /shopping cart/i })`. If DOM contradicts (element has no accessible name, or is a `<button>` rather than `<a>`): keep `page.locator('.shopping_cart_link')`, add WHY-comment `'Q5 unresolved — cart link accessible name not confirmed'`. Reviewer fallback: inspect `aria-label` or link text in devtools; if absent, ask FE team to add `aria-label="Shopping Cart"`.

## Structural changes

### Pages

**`outputs/helper/page-object/pages/saucedemo-login.page.ts`** — `PageClassSaucedemoLogin extends BasePage`

- `readonly url = '/'`
- Locator fields: `inputUsername` (getByLabel /username/i), `inputPassword` (getByLabel /password/i), `buttonLogin` (getByRole button /log in/i)
- `open(): Promise<void>` — `page.goto(this.url)` → `waitForPageLoad()`
- `waitForPageLoad(): Promise<void>` — `expect(this.inputUsername).toBeVisible()`
- `fillCredentials(username: string, password: string): Promise<void>` — fills inputUsername then inputPassword
- `clickLogin(): Promise<PageClassSaucedemoInventory>` — clicks buttonLogin, constructs and returns `new PageClassSaucedemoInventory(this.page)` after `waitForPageLoad()` on it

**`outputs/helper/page-object/pages/saucedemo-inventory.page.ts`** — `PageClassSaucedemoInventory extends BasePage`

- `readonly url = '/inventory.html'` (inferred from saucedemo convention — Q6 may affect this)
- Locator fields: `headingProducts` (getByRole heading /products/i), `arrayInventoryItems` (locator('.inventory_item')), `linkShoppingCart` (getByRole link /shopping cart/i)
- `waitForPageLoad(): Promise<void>` — `expect(this.headingProducts).toBeVisible()`

### Fixture

**`outputs/helper/fixtures/base.fixture.ts`** (mutate) — extend `Fixtures` type with `loginPage: PageClassSaucedemoLogin` and `inventoryPage: PageClassSaucedemoInventory`; add fixture entries that `new PageClass...(page)`.

### Test data

**`outputs/helper/test-data/labels.ts`** (mutate) — add `LABEL_LOGIN = "Login"` and `LABEL_INVENTORY = "Inventory"`.

Credentials are **not** test-data constants — they are env vars (`SAUCEDEMO_USERNAME`, `SAUCEDEMO_PASSWORD`) read at runtime by the spec via `process.env`.

### No blocks, API wrappers, actions, utilities, or types

- Block: no section with ≥5 locators or ≥3 methods on either page.
- API wrapper: source test IS the test that owns the login UI flow (migration-rules §5d exception).
- Action: the login → inventory navigation is a two-page journey but is encapsulated by `PageClassSaucedemoLogin.clickLogin()` returning the inventory POM, which is the canonical single-navigation pattern. An `actions/` file is not warranted for a single linear step.
- Utility: no text parsing required.
- Types: no API response shapes or internal value objects.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/saucedemo-login.page.ts` | login form locators, fillCredentials, clickLogin → InventoryPage |
| Page | `outputs/helper/page-object/pages/saucedemo-inventory.page.ts` | inventory locators, waitForPageLoad, count assertion surface |
| Block | (none) | no section ≥5 locators or ≥3 methods |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | add loginPage + inventoryPage injection |
| API | (none) | source owns the login UI flow — no pre-seeded data required |
| Action | (none) | single linear two-page navigation; encapsulated on LoginPage.clickLogin() |
| Utility | (none) | no DOM string parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | add LABEL_LOGIN + LABEL_INVENTORY constants |
| Type | (none) | no API shapes or internal value objects |
| Spec | `outputs/tests/saucedemo-login.spec.ts` | the migrated test |

## Open questions for reviewer

Q1: Do the `#user-name` and `#password` input fields have associated `<label>` elements (or `aria-label` / `aria-labelledby` attributes) that would confirm `getByLabel(/username/i)` and `getByLabel(/password/i)` as correct locators?
Context: Lines 6–7; locator table rows 1–2; hallucination-defense pins 1–2.
What I assumed: Labels exist — `getByLabel` is the primary proposal.
Impact if assumption is wrong: Stage 2 emits locators that find nothing at runtime; fallback to `page.locator('#user-name')` / `page.locator('#password')` applies. If fields have placeholder text instead of labels, `getByPlaceholder` is the alternative upgrade.

Q2: Is `#login-button` a `<button>` element or an `<input type="submit">`? What is its accessible name / visible label?
Context: Line 9; locator table row 3; hallucination-defense pin 3.
What I assumed: A `<button>` with accessible name matching `/log in/i`.
Impact if assumption is wrong: `getByRole('button', { name: /log in/i })` fails to match; Stage 2 must fall back to `page.locator('#login-button')`.

Q3: Is the `.title` element a semantic heading (`<h1>`, `<h2>`, etc.) or a styled non-heading (`<span>`, `<div>`)?
Context: Line 11; locator table row 4; hallucination-defense pin 4.
What I assumed: A semantic heading, so `getByRole('heading', { name: /products/i })` is safe.
Impact if assumption is wrong: Role query finds no heading; fallback to `page.getByText('Products', { exact: true })` or `page.locator('.title')`.

Q4: Do the `.inventory_item` elements have a `data-test`, `data-testid`, `role` attribute, or aria accessible name that would allow a stable locator upgrade beyond the CSS class?
Context: Line 12; locator table row 5.
What I assumed: None — CSS class preserved as `page.locator('.inventory_item')`.
Impact if assumption is wrong: If a testid exists, we're leaving a higher-quality locator on the table. Reviewer should add `data-testid="inventory-item"` to the SUT if not present.

Q5: Does `.shopping_cart_link` have an accessible name (via `aria-label`, `title`, or visible link text)? Is it an `<a>` or `<button>`?
Context: Line 13; locator table row 6; hallucination-defense pin 5.
What I assumed: An `<a>` link with accessible name matching `/shopping cart/i`.
Impact if assumption is wrong: `getByRole('link', { name: /shopping cart/i })` finds nothing; fallback to `page.locator('.shopping_cart_link')`.

Q6: Is this test targeting the live public `https://www.saucedemo.com`, or is there a local / staging instance? The migration moves the base URL to `playwright.config.ts` (`baseURL`). The runner must set `BASE_URL=https://www.saucedemo.com` (or equivalent) for the test to resolve correctly.
Context: Line 5, `cy.visit('https://www.saucedemo.com/')`.
What I assumed: `BASE_URL` will be set to `https://www.saucedemo.com` in the target environment.
Impact if assumption is wrong: `loginPage.open()` navigates to `http://localhost:3000` (the config default) — test fails immediately to reach the SUT.

Q7: Should the `standard_user` / `secret_sauce` credentials be env vars (for forward compatibility with credential rotation) or named constants in `test-data/` (since they are public demo credentials)? Migration-rules KB-1.1.9 classifies any hardcoded credential string as an H-severity smell regardless of sensitivity.
Context: Lines 6–7.
What I assumed: Env vars (`SAUCEDEMO_USERNAME`, `SAUCEDEMO_PASSWORD`) — `.env` file must document the values so other contributors can onboard.
Impact if assumption is wrong: If reviewer prefers named constants (e.g., `SAUCEDEMO_STANDARD_USER = 'standard_user'`), update `test-data/` and adjust the spec accordingly.

Q8: The source test has no negative scenario (invalid password → error banner). Should Stage 2 add one, or is this strictly a migration-only pass?
Context: Single `it()` block in source.
What I assumed: Migration covers only the existing positive scenario. Negative path is a future enhancement.
Impact if assumption is wrong: No code bug — it's additive. Reviewer should open a follow-up ticket to cover the error state.

## Risk callouts

- **Network dependency on live public SUT:** This test hits `https://www.saucedemo.com`, a third-party demo site not under the project's control. Any SauceDemo outage, rate-limiting, or API change will fail the test for infrastructure reasons. Mitigation: tag the test `@e2e` and configure `retries: 2` in CI `playwright.config.ts`. Consider whether a local / Docker instance of SauceDemo is feasible for a network-independent run.

- **Brittle count assertion — 6 inventory items:** `toHaveCount(6)` will break if saucedemo changes its product catalog. The migration preserves the intent as a named constant (`EXPECTED_INVENTORY_COUNT = 6`). Reviewer should decide whether exact-count or `toBeGreaterThan(0)` is the right oracle for this test.

- **Hard-wait masking real rendering slowness:** `cy.wait(2000)` after login (Line 10) may have been masking a genuine inventory page render lag. Replacing with `await expect(inventoryPage.headingProducts).toBeVisible()` will expose any SUT slowness that exceeds `actionTimeout: 5_000`. If the inventory page consistently takes >5s on a cold start, the reviewer must increase `navigationTimeout` for this step and document the reason.

- **Credentials in source committed to git:** Even though `standard_user` / `secret_sauce` are public demo credentials, they are committed plaintext in the source. The migration moves them to env vars and removes them from the git-tracked spec — this is a one-way change; the `.env` file must carry the values going forward.

- **No negative test path:** The absence of an error-scenario test means a regression where the login form accepts any password would not be caught by this suite. Track as a follow-up (Q8).

## Expected metrics

- Selector quality score (estimated post-migration): 0.83 (5/6 locators will be role/label-based assuming all MED proposals succeed: `getByLabel` ×2, `getByRole/button` ×1, `getByRole/heading` ×1, `getByRole/link` ×1 = 5; `.inventory_item` CSS class = 1 remaining low-quality)
- Smell count delta: −10 (−2 hard waits, −3 CSS id selectors, −3 CSS class selectors, −1 hardcoded URL, −2 hardcoded credentials) / +0 new smells introduced
- LOC delta: +105 estimated (source 15 LOC → spec ≈45 + LoginPage ≈35 + InventoryPage ≈30 + fixture delta ≈5 + labels delta ≈5 = ≈120 total new LOC; minus 15 source = +105 net)
- Anti-pattern coverage: 10/10 addressed
