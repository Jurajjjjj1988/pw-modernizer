# Migration plan: selenium-java-03-multifile-login (Selenium Java multi-file -> Playwright TypeScript)

## Source → Target

- Source framework: selenium-java
- Source unit: directory `input/` (4 files)
  - `input/LoginTest.java` (40 LOC) — JUnit 5 test class with two `@Test` methods
  - `input/pages/LoginPage.java` (43 LOC) — PageFactory POM with `@FindBy` annotations
  - `input/pages/BasePage.java` (40 LOC) — POM superclass owning `driver`, `wait`, helpers
  - `input/helpers/WebDriverConfig.java` (40 LOC) — `ThreadLocal<WebDriver>` provider with `implicitlyWait(10s)` + headless Chrome
- Target framework: Playwright TypeScript
- Target file(s):
  - `outputs/tests/selenium-java-03-multifile-login.spec.ts` (1 spec, two tests)
  - `outputs/tests/pages/login.page.ts` (slim POM, ~30 LOC)
  - The `BasePage.java` and `WebDriverConfig.java` files have NO target counterpart — they fold into Playwright's `page` fixture.

## Summary

Acme Shop login: a valid credential pair routes the user to `/dashboard`, and an invalid pair shows an error banner with the literal message "Invalid credentials". The source is a 4-file Selenium suite using the PageFactory `@FindBy` pattern, ThreadLocal driver provider, JUnit 5 lifecycle, and a `BasePage` superclass. The migration collapses the 3 plumbing files into Playwright's built-in `page` fixture and reshapes `LoginPage` from PageFactory eager-init into a slim Playwright POM with role-based locators.

## What bug does this catch?

The login flow's two contracts: (a) the dashboard URL post-redirect is reached on success, (b) the error banner copy on failure is exactly "Invalid credentials" (a regression in the error message would silently drift product copy from spec).

## User-perceivable assertion checklist

| # | Source line | Assertion | Migrated as |
|---|---|---|---|
| 1 | `LoginTest.java:31` `assertTrue(loginPage.isOnDashboard())` | URL contains `/dashboard` after sign-in | `await expect(page).toHaveURL(/\/dashboard/)` |
| 2 | `LoginTest.java:32` `assertTrue(currentUrl().contains("/dashboard"))` | DUPLICATE of #1 — collapses | dropped (documented in disagreements) |
| 3 | `LoginTest.java:38` `assertTrue(loginPage.hasError())` | Error banner is visible after invalid sign-in | `await expect(login.errorBanner).toBeVisible()` |
| 4 | `LoginTest.java:39` `assertEquals("Invalid credentials", loginPage.errorText())` | Error banner text equals "Invalid credentials" | `await expect(login.errorBanner).toHaveText('Invalid credentials')` |

## Anti-patterns detected

| Severity | File:Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | `LoginPage.java:29` | KB-1.3.1 | hard-wait | `Thread.sleep(1500)` | drop; rely on `await expect(...).toHaveURL(...)` |
| H | `WebDriverConfig.java:25` | KB-1.3.11 | implicit-wait-global | `implicitlyWait(Duration.ofSeconds(10))` | delete; Playwright auto-retries assertions |
| H | `LoginPage.java:15` | KB-1.3.2 | xpath-deep | `//form//button[@type='submit']` | `page.getByRole('button', { name: 'Sign in' })` |
| H | `LoginPage.java:13` | KB-1.3.14 | pagefactory-eager-init | `@FindBy(id = "email") private WebElement emailInput` | Playwright POM: `readonly emailField = page.getByLabel('Email')` |
| H | `BasePage.java:18` | KB-1.3.14 | pagefactory-init-elements | `PageFactory.initElements(driver, this)` | drop; locators are lazy in Playwright |
| H | `LoginPage.java:16` | KB-1.3.3 | css-class-selector | `.error-banner` | `page.getByRole('alert')` |
| H | `WebDriverConfig.java:15` | KB-1.3.16 | threadlocal-driver | `static ThreadLocal<WebDriver> DRIVER` | drop; Playwright workers each own a `page` |
| M | `BasePage.java:28` | KB-1.3.8 | try-catch-as-flow | `try { ... } catch (NoSuchElementException) { return false; }` | `await expect(locator).toBeVisible()` or `.toBeHidden()` |
| M | `LoginPage.java:32` | KB-1.3.15 | expected-conditions-verbose | `ExpectedConditions.urlContains("/dashboard")` | `await expect(page).toHaveURL(/\/dashboard/)` |
| M | `LoginTest.java:21` | KB-1.3.12 | manual-driver-quit | `WebDriverConfig.quit()` in `@AfterEach` | drop; `page` fixture auto-disposes |
| M | `BasePage.java:5` | KB-1.3.5 | base-page-inheritance | `class LoginPage extends BasePage` | composition over inheritance; POM is standalone |
| M | `LoginTest.java:31,38` | KB-1.3.10 | non-web-first-assertion | `assertTrue(loginPage.isOnDashboard())` | `await expect(page).toHaveURL(...)` |
| M | `WebDriverConfig.java:27` | KB-1.3.11 | maximize-window | `manage().window().maximize()` | viewport at config level (or omit) |
| L | `LoginPage.java:10` | KB-1.4.12 | hardcoded-url | `"https://shop.acme.test/login"` | `baseURL` in `playwright.config.ts`, `page.goto('/login')` |
| L | `LoginTest.java:27,35` | KB-1.3.1 | throws-InterruptedException-boilerplate | `throws InterruptedException` | drop with `Thread.sleep` |

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `@FindBy(id = "email")` | `page.getByLabel('Email')` | medium | Assumes the input has a `<label for="email">`. If placeholder-only, fall back to `getByPlaceholder('Email')`. If neither, `page.locator('#email')`. |
| `@FindBy(id = "password")` | `page.getByLabel('Password')` | medium | Same assumption. |
| `@FindBy(how = XPATH, using = "//form//button[@type='submit']")` | `page.getByRole('button', { name: 'Sign in' })` | high | Form submit is the Sign in CTA. |
| `@FindBy(css = ".error-banner")` | `page.getByRole('alert')` | medium | Error banners are commonly `role="alert"` (live region). If the element is just a styled div, fall back to `page.getByTestId('error-banner')` or `page.getByText('Invalid credentials')`. |
| `By.cssSelector(".error-banner")` (in `hasError()`) | `await expect(login.errorBanner).toBeVisible()` | high | Same node; the visibility check folds into the assertion. |

## Hallucination-defense pins

1. **Email input** — assumed `page.getByLabel('Email')`. If the input has no `<label for="email">`: keep `@FindBy(id = "email")` → `page.locator('#email')`, add WHY-comment `'Q1 unresolved: Email label association'`. Reviewer fallback: ask FE team to add `<label for="email">Email</label>` OR switch to `page.getByPlaceholder('Email')`.
2. **Password input** — assumed `page.getByLabel('Password')`. If the input has no `<label for="password">`: keep `page.locator('#password')`, add WHY-comment `'Q1 unresolved: Password label association'`. Reviewer fallback: same as Email — ask FE team for a `<label>` OR use `page.getByPlaceholder('Password')`.
3. **Error banner** — assumed `page.getByRole('alert')`. If the element is just a styled `<div>` without `role="alert"`: keep `@FindBy(css = ".error-banner")` → `page.locator('.error-banner')`, add WHY-comment `'Q2 unresolved: alert role / aria-live on error banner'`. Reviewer fallback: ask FE team to add `role="alert"` to the live region, OR use `page.getByTestId('error-banner')`, OR fall back to `page.getByText('Invalid credentials')`.

## Structural changes

- **Extract POM: YES** — kept as `login.page.ts`. The source already had a POM; the migration reshapes it to Playwright conventions (composition over inheritance, lazy locators, no PageFactory). Slim — locators + `open()` + `signIn()` only. No assertions inside the POM.
- **Extract fixture: NO** — single feature with two tests; the `page` fixture suffices. (Could promote to a `storageState` fixture later if login becomes shared setup for unrelated suites.)
- **Split into multiple specs: NO** — both tests cover one feature (login).
- **Files dropped (no target counterpart):**
  - `BasePage.java` — its `wait`, `waitVisible`, `isVisibleSafe`, `currentUrl()` helpers all map to Playwright built-ins (`expect(...).toBeVisible()`, `page.url()`).
  - `WebDriverConfig.java` — ThreadLocal driver + implicitlyWait + maximize are entirely replaced by Playwright's worker-scoped `page` fixture and project-level config.
- Justification per `migration-rules.md` §1: 4 files of source plumbing become 2 files of test code. Net LOC: 163 → ~60 (-63%). Slim POM is justified because both tests use the same locators; inlining would duplicate them.

## Selenium multi-file unit notes

This is a directory input. The plan describes the WHOLE unit, not a single file.

- Read order for the LLM: `LoginTest.java` (entry point — establishes feature intent), then `LoginPage.java` (locators + actions), then `BasePage.java` (shared helpers), then `WebDriverConfig.java` (driver lifecycle).
- POM replacement is NOT a 1:1 file translation. The Selenium POM is THREE files (`BasePage.java` + `LoginPage.java` + `WebDriverConfig.java`). The Playwright POM is ONE file (`login.page.ts`). The other two fold into Playwright's `page` fixture and project config.
- Test class structure: JUnit 5 `@BeforeEach`/`@AfterEach` becomes Playwright's per-test fixture lifecycle. Each `@Test` method becomes a `test(...)` call inside `test.describe(...)`.
- Naming: source class `LoginTest` → Playwright file `selenium-java-03-multifile-login.spec.ts` (matches the input directory name per pipeline convention).

## Open questions for reviewer

```
Q1: Is the Email input associated with a <label>, or does it use only a placeholder?
Context: LoginPage.java:13 @FindBy(id = "email") — id-only selector gives no hint about labelling.
What I assumed (proceeding without an answer): The form has <label for="email">Email</label>.
Impact if wrong: getByLabel('Email') will not match — test fails immediately. Fallback is getByPlaceholder('Email') or page.locator('#email').
```
```
Q2: Does the error banner have role="alert" (or aria-live="assertive") in the rendered DOM?
Context: LoginPage.java:16 @FindBy(css = ".error-banner") — class-based selector.
What I assumed: role="alert" is present (industry-standard a11y pattern for login errors).
Impact if wrong: getByRole('alert') will not match. Fallback is getByText('Invalid credentials') — also bypasses the role assertion.
```
```
Q3: Is the Sign in button labelled "Sign in" or "Log in" / "Sign In" / localised?
Context: LoginPage.java:15 XPath '//form//button[@type=\'submit\']' — no name hint.
What I assumed: The button's accessible name is "Sign in" (matches the Acme Shop convention used elsewhere in the suite).
Impact if wrong: getByRole('button', { name: 'Sign in' }) will not match. Confirm via DOM inspection.
```
```
Q4: Should the migrated `signIn()` method clear the inputs before filling?
Context: LoginPage.java:24-27 calls `.clear()` then `.sendKeys(...)`.
What I assumed: Playwright's `fill()` already clears the input first (this is its documented behaviour), so the explicit clear is unnecessary.
Impact if wrong: None — `fill()` is documented to replace, not append. Surfaced for visibility only.
```

## Risk callouts

- **`Thread.sleep(1500)` masks a real form-submit-to-redirect latency.** The migrated test relies on `await expect(page).toHaveURL(/\/dashboard/)` which polls until the default `expect` timeout (5s). If the real redirect ever takes longer than 5s in CI, the test will fail. Bump per-assertion timeout if observed.
- **The `BasePage.isVisibleSafe()` try/catch helper was used in `LoginPage.hasError()`** — the migration replaces "is it there?" with `await expect(banner).toBeVisible()`, which now WAITS for the banner to appear. The Selenium version returned `false` immediately if the banner wasn't in the DOM. If the error banner takes ≥5s to render on the first invalid attempt, the migrated assertion will surface that as a real timing bug. This is arguably better — the old version hid the slowness.
- **`WebDriverConfig.quit()` was called in `@AfterEach`.** Playwright's `page` fixture handles teardown automatically. No explicit cleanup needed; if a contributor adds one, it will throw "browser closed".
- **Parallel test runs**: the ThreadLocal pattern was the Selenium accommodation for parallel JUnit runners. Playwright handles parallelism via worker processes (each worker has its own browser context), so no driver isolation is needed in user code.

## Disagreements with the plan (informational)

- The source asserts the dashboard URL TWICE in `validCredentialsLandOnDashboard` (`isOnDashboard()` then `currentUrl().contains("/dashboard")`). The migration collapses these into ONE `toHaveURL(/\/dashboard/)` because the second was an internal-detail duplicate of the first. Log as a checklist drop (#2 above).
- The source had a `maximize()` call in `WebDriverConfig`. The migration uses the Playwright default viewport (1280×720) instead. If the test needs full-screen rendering (mobile menu hidden at narrow viewports), surface this in a follow-up — but two-test login flow does not need it.

## Expected metrics

- Selector quality score: 4/4 role/label-based (was 0/4 via PageFactory id/css/xpath).
- Smell count delta: -1 `Thread.sleep`, -1 `implicitlyWait`, -1 deep XPath, -2 PageFactory `@FindBy`, -1 `PageFactory.initElements`, -1 ThreadLocal driver, -1 try-catch-as-flow, -1 ExpectedConditions ceremony, -1 manual driver.quit, -1 BasePage inheritance, -2 non-web-first assertions, -1 maximize, -1 hardcoded URL, -1 `throws InterruptedException`.
- LOC delta: 163 → ~60 (-63% across the unit; biggest savings are dropping `WebDriverConfig.java` and `BasePage.java` entirely).
- Files delta: 4 → 2 (-2 files; `BasePage` and `WebDriverConfig` have no target).
- Anti-pattern coverage: 15 catalog rows / ~15 distinct smells in source.
