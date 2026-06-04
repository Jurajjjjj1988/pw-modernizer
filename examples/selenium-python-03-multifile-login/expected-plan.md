# Migration plan: test_login.py (multi-file)

## Source framework
selenium-python — pytest + Selenium WebDriver 4.x. Multi-file unit:
- `test_login.py` — test module with 2 functions
- `pages/login_page.py` — POM extending BasePage
- `pages/base_page.py` — base class holding driver + WebDriverWait
- `helpers/driver_config.py` — module-level singleton driver

Target: Playwright TypeScript, role-based locators, per-test BrowserContext.

## Summary
Login flow with happy-path + error-path. Migration collapses the BasePage
inheritance into a single per-page POM (Playwright Locator is lazy +
auto-retrying, so no `wait` field needed), drops the singleton driver in
favor of Playwright's per-test page fixture, and replaces the
WebDriverWait/ExpectedConditions ceremony with web-first assertions.

### User-perceivable assertion checklist
- [x] After signing in with valid credentials, the Dashboard heading is
      visible AND the "Welcome, Jane" text is visible.
- [x] After signing in with invalid credentials, an inline error reading
      "Invalid email or password" appears.

## Anti-patterns detected
- [x] `time.sleep(1)` after submit (KB-1.4.1) — replace with web-first assertion.
- [x] `WebDriverWait + EC.presence_of_element_located` ceremony (KB-1.4.4)
      — Playwright Locator auto-retries.
- [x] `By.XPATH` with positional + text predicate `//form//button[@type='submit']`
      and `//header//h1[contains(text(),'Dashboard')]` (KB-1.4.2) — use role + name.
- [x] `By.CSS_SELECTOR ".form-error"` styling-class (KB-1.4.3) — `getByRole('alert')`.
- [x] BasePage god-class with `BASE_URL`, `driver`, `wait` (KB-1.3.5) — flatten.
- [x] `driver.implicitly_wait(5)` global timeout (KB-1.4.16) — drop.
- [x] `assert "Welcome, Jane" in driver.page_source` (KB-1.4.6) — assert visible text.
- [x] `assert el.text == "..."` direct equality (KB-1.4.13) — `toHaveText`.
- [x] Module-level singleton driver in `DriverConfig` (KB-1.3.5 BasePage-style)
      — Playwright's per-test `page` fixture replaces it.
- [x] `try/except` around `WebDriverWait` to return bool (KB-1.4.8) —
      use `expect().toBeVisible()` with timeout; explicit + readable.

## Locator translation table
| Original | New | Confidence | Notes |
|---|---|---|---|
| `By.ID "email"` | `page.getByLabel('Email')` | medium | Assumes `<label for="email">Email</label>`. Fallback: `getByRole('textbox', { name: /email/i })`. |
| `By.ID "password"` | `page.getByLabel('Password')` | medium | Same. |
| `By.XPATH "//form//button[@type='submit']"` | `page.getByRole('button', { name: /sign in/i })` | medium | Visible button label assumed; if different, swap name. |
| `By.CSS_SELECTOR ".form-error"` | `page.getByRole('alert')` | medium | Assumes alert role; fallback `getByText('Invalid email or password')`. |
| `By.XPATH "//header//h1[contains(text(),'Dashboard')]"` | `page.getByRole('heading', { name: 'Dashboard', level: 1 })` | high | Heading text is verbatim "Dashboard". |

## Hallucination-defense pins
1. **Sign-in button label** — assumed `/sign in/i`, keep `By.XPATH "//form//button[@type='submit']"` shape in WHY-comment. Reviewer fallback: if real label is "Log in" or "Submit", swap.
2. **Email/Password labels** — assumed associated `<label>`. Reviewer fallback: if inputs use `placeholder` only, use `getByPlaceholder`.

## Structural changes
- Extract POM: yes — `outputs/tests/pages/login.page.ts` (single Locator-based POM, no inheritance).
- Extract fixture: no — Playwright's built-in `page` replaces `DriverConfig`.
- Drop BasePage: yes — flattened into one POM.
- Drop helpers/driver_config.py: yes — Playwright manages driver lifecycle.
- Split into multiple specs: no.

## Open questions for reviewer
- The Selenium test uses `assert "Welcome, Jane" in driver.page_source` to confirm dashboard. The migrated test uses both `getByRole('heading', { name: 'Dashboard' })` AND `getByText('Welcome, Jane')`. Keep both for defense-in-depth, or drop the second if it's redundant?
- The error message Selenium test reads `el.text == "Invalid email or password"`. The migrated test uses `toHaveText` (exact match). Confirm the SUT emits this exact string — if it has a trailing period or whitespace, switch to `toContainText` or a regex.

## Risk callouts
- `DriverConfig` singleton means in original Selenium suite all tests share state — cookies, localStorage, URL. The migrated tests each get a fresh BrowserContext, which is correct but may surface latent test ordering issues that were masked by the singleton.
- `WebDriverWait(5)` in `is_on_dashboard()` returned `False` on timeout (the `try/except`). Playwright assertions THROW on timeout. The migrated test's `expect(...).toBeVisible()` will fail loudly instead of returning a bool — desired behavior.

## Expected metrics
- Selector quality score: 5/5 role/label-based.
- Smell count delta: -1 sleep, -1 WebDriverWait, -2 XPath, -1 CSS class, -1 BasePage god-class, -1 implicit wait, -1 page_source assertion, -1 element.text equality, -1 singleton driver, -1 try/except presence check.
- LOC delta: 96 input → ~28 output spec + ~22 POM ≈ 50 (-46 lines).
- Anti-pattern coverage: 10/10.
