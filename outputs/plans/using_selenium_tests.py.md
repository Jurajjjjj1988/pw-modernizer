# Migration plan: using_selenium_tests.py

## Source framework

Selenium WebDriver (Python) — no pytest decorators; plain `def test_*()` function with manual `setup()` / `teardown()` helpers. Driver is `webdriver.Chrome()` (ChromeDriver, version not pinned in source). No `conftest.py`, no `@pytest.fixture`, no `pytest-xdist`. Target: Playwright TypeScript, latest stable (v1.x).

## Summary

This test exercises a simple HTML web form: it navigates to the Selenium project's public demo page (`web-form.html`), asserts the page title, fills a single text input, clicks the submit button, and verifies the server's confirmation message appears. The entire interaction is contained in one function (`test_eight_components`), which includes its own driver lifecycle management via `setup()` / `teardown()` helpers.

### What bug does this catch?

Catches a regression where submitting the demo web form with valid text input fails to produce the "Received!" confirmation message — i.e., the form submission is broken or the result element is not rendered.

### User-perceivable assertion checklist

- [ ] After navigation to `web-form.html`: page title equals `"Web form"`
- [ ] After filling the text input with `"Selenium"` and clicking the submit button: the element with ID `message` displays the text `"Received!"`

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 27 | KB-1.4.12 | hardcoded-url | `driver.get("https://www.selenium.dev/…")` | configure `baseURL` in `playwright.config.ts`; use `page.goto('/selenium/web/web-form.html')` |
| H | 5–23 | KB-1.4.5 | manual-driver-setup-teardown | `driver = setup()` … `teardown(driver)` | drop `setup()`/`teardown()`; use Playwright's `page` fixture |
| H | 11 | KB-1.4.16 | implicit-wait-mid-test | `driver.implicitly_wait(0.5)` | remove; set `actionTimeout` in `playwright.config.ts` |
| M | 13 | KB-UNCLASSIFIED | `By.NAME` non-semantic selector | `find_element(by=By.NAME, value="my-text")` | `page.getByLabel(/text input/i)` — label text unverified; see Q1, pin 1 |
| M | 14 | KB-1.4.3 | generic-css-tag-selector | `find_element(by=By.CSS_SELECTOR, value="button")` | `page.getByRole('button', { name: /submit/i })` — accessible name unverified; see Q2, pin 2 |
| M | 8–9 | KB-1.4.13 | sync-probe-title-equality | `title = driver.title; assert title == "Web form"` | `await expect(page).toHaveTitle('Web form')` |
| M | 20–21 | KB-1.4.13 | sync-probe-text-equality | `value = message.text; assert value == "Received!"` | `await expect(locator).toHaveText('Received!')` |
| L | 31 | KB-1.3.12 | manual-driver-quit | `driver.quit()` | dropped — Playwright's `page` fixture auto-closes the `BrowserContext` |

**Unclassified smells:**

- `By.NAME` (line 13): The `By.NAME` locator strategy (selects by HTML `name` attribute) has no dedicated entry in `config/knowledge-base.md`. It is closest in intent to a CSS-selector or attribute-selector strategy; the migration should prefer `getByLabel` or `getByPlaceholder` if the app provides accessible label or placeholder text for the field. Reviewer should confirm whether KB-1.4.3 is the appropriate label or whether a new KB entry is warranted.
- Function name `test_eight_components` (line 5): The name implies testing eight UI components but the test covers a single form submission flow with two assertions. Name is misleading; the Playwright version should use a descriptive verb-phrase title. See Q7.

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `driver.find_element(by=By.NAME, value="my-text")` (line 13) | `page.getByLabel(/text input/i)` | med | `name="my-text"` implies a labeled text field; label text guessed from common web-form patterns — DOM verification required. Fallback: `page.locator('[name="my-text"]')`. See Q1, pin 1. |
| `driver.find_element(by=By.CSS_SELECTOR, value="button")` (line 14) | `page.getByRole('button', { name: /submit/i })` | low | Generic tag selector `"button"` gives no accessible-name evidence; "Submit" is assumed from form semantics. Any additional button before the submit button would break the original. See Q2, pin 2. |
| `driver.find_element(by=By.ID, value="message")` (line 19) | `page.locator('#message')` | high | Direct ID mapping. If the element carries `role="status"` or `role="alert"`, prefer `page.getByRole(...)` for a quality score upgrade. See Q3. |

## Hallucination-defense pins

1. **Text input field** — assumed `page.getByLabel(/text input/i)`. If DOM contradicts (no associated `<label>` for `name="my-text"`): keep `page.locator('[name="my-text"]')`, add WHY-comment `'Q1 unresolved: label text not confirmed for name="my-text"'`. Reviewer fallback: inspect `web-form.html` source for the visible label text above the text input, then supply exact regex; or ask team to add `data-testid="text-input"`.

2. **Submit button** — assumed `page.getByRole('button', { name: /submit/i })`. If DOM contradicts (button text differs from "Submit" or button has no accessible name): keep `page.locator('button[type="submit"]')` as a structural fallback, add WHY-comment `'Q2 unresolved: submit button accessible name not confirmed'`. Reviewer fallback: inspect the `<button>` element in `web-form.html` for its visible text content and replace `/submit/i` with the correct regex.

## Structural changes

- **Extract POM:** no — single page, one interaction, ~32 LOC source. Well below the 200-LOC POM threshold (`migration-rules.md` §1).
- **Extract fixture:** no — single test, no shared setup beyond `page.goto(...)`. Playwright's built-in `page` fixture is sufficient; navigation moves to `test.beforeEach`.
- **Split into multiple specs:** no — single feature, single scenario.
- **Inline everything:** yes — all logic fits in one `test.describe` + one `test(...)` block.

**Per-file fate:**

| Source element | Fate | Reason |
|---|---|---|
| `using_selenium_tests.py` | **KEPT and RESHAPED** → `outputs/tests/using_selenium_tests.spec.ts` | Contains the one test scenario to migrate |
| `setup()` function (lines 25–29) | **DROPPED** | Driver creation and navigation replaced by `page` fixture + `test.beforeEach(() => page.goto(...))` |
| `teardown()` function (lines 30–32) | **DROPPED** | `driver.quit()` replaced by Playwright's automatic `BrowserContext` teardown per test |

## Open questions for reviewer

```
Q1: What is the visible label text for the text input with `name="my-text"` on `web-form.html`?
Context: Line 13 — `By.NAME, "my-text"` gives no label evidence. The field is presumably labeled
         (it is a public Selenium demo form), but the label string is unknown from the source.
What I assumed (if proceeding without answer): `getByLabel(/text input/i)` — a common convention
         for a general text input field on a demo form.
Impact if wrong: Stage 2 emits a locator that never resolves; test fails at the `.fill()` step
         with a "strict mode violation" or timeout — not a silent pass.
```

```
Q2: What is the accessible name (visible button text) of the submit button on `web-form.html`?
Context: Line 14 — `By.CSS_SELECTOR, "button"` is so generic it matches any button in DOM order.
         No text evidence in source. "Submit" is a common default but not verified.
What I assumed (if proceeding without answer): `getByRole('button', { name: /submit/i })`.
Impact if wrong: Stage 2 either fails to find the button (strict-mode error if multiple buttons
         exist) or clicks the wrong one and the test passes while missing the actual interaction.
```

```
Q3: Does the `#message` element on `web-form.html` carry a semantic ARIA role
    (e.g., `role="status"`, `role="alert"`, or an implicit role from a heading/paragraph)?
Context: Line 19-21. `locator('#message')` is HIGH confidence for finding the element, but
         upgrading to `getByRole(...)` would push selector quality from 0.67 → 1.0 (3/3).
What I assumed (if proceeding without answer): `locator('#message')` — safe, ID is stable.
Impact if wrong: No functional impact. An available role-based upgrade would be missed,
         keeping the suite slightly below the 0.7 quality threshold.
```

```
Q4: Should the page title assertion (`assert title == "Web form"`) be preserved?
Context: Lines 8-9. The page title is user-perceivable (browser tab), but asserting it as
         the FIRST thing after navigation adds little regression value compared to the
         form-submission assertion on line 21.
What I assumed (if proceeding without answer): preserve it as `await expect(page).toHaveTitle('Web form')`.
         The original author chose to assert it, so removing it silently drops a check.
Impact if wrong: If preserved unnecessarily, any page-title copy change breaks the test with
         no product regression signal. If removed, we lose a cheap navigation guard.
```

```
Q5: What `baseURL` should be configured for the migrated test's target environment?
Context: Line 27 — `driver.get("https://www.selenium.dev/selenium/web/web-form.html")`.
         The migration must move the hostname to `playwright.config.ts` `baseURL` and
         use a relative `page.goto(...)` path.
What I assumed (if proceeding without answer): `baseURL = "https://www.selenium.dev"`,
         relative path = `/selenium/web/web-form.html`.
Impact if wrong: If the test suite is actually meant to target a LOCAL or STAGING version
         of this form (i.e., the team cloned or hosts their own copy), the hardcoded
         selenium.dev URL is entirely wrong and the `baseURL` must be corrected in config.
```

```
Q6: Is the hardcoded string `"Selenium"` as the form input a deliberate test value,
    or should it be a named constant / env-var-driven?
Context: Line 16 — `text_box.send_keys("Selenium")`. The value has no semantic name.
What I assumed (if proceeding without answer): extract to `const INPUT_TEXT = "Selenium"` to
         remove the magic string (KB-1.1.9 analogue), preserving the value.
Impact if wrong: If the form validates the input or the server echoes it in the response,
         any change to the value must be reflected in both the fill and the assertion.
         A named constant makes that coupling explicit.
```

```
Q7: The function name `test_eight_components` does not describe the tested behaviour.
    What should the Playwright test title be?
Context: Line 5. The function name implies eight components are verified, but the test
         exercises one form-submission flow with two assertions.
What I assumed (if proceeding without answer): rename to
         "submits web form text input and receives confirmation @positive".
Impact if wrong: A misleading test title makes CI output harder to triage. No functional
         impact on test execution.
```

## Risk callouts

- **External network dependency:** The test targets `https://www.selenium.dev/selenium/web/web-form.html` — a live external site. If selenium.dev is slow, down, or changes its HTML, the test fails for reasons unrelated to the application under test. The migration cannot fix this architectural issue without the team hosting their own copy of the form.
- **Generic `button` selector fragility (LOW confidence locator):** `By.CSS_SELECTOR, "button"` matches the FIRST `<button>` in DOM order. If the form ever adds a "Reset" or "Back" button before the submit button, the source test would already be clicking the wrong element and passing silently. The Playwright migration to `getByRole('button', { name: /submit/i })` mitigates this — but only if the button's accessible name is confirmed (Q2).
- **No negative path coverage:** The source test covers only the happy path. There are no tests for: empty input, over-long input, special characters, or server error. The migration preserves this gap intentionally — adding coverage is out of scope for the migration step.
- **`implicitly_wait(0.5)` masking a latency assumption:** The 0.5-second implicit wait is shorter than Playwright's default `actionTimeout` (5s from `migration-rules.md`). Removing the wait and relying on Playwright's defaults is correct, but if the target environment is genuinely slow (>5s to render the `#message` element), the CI will surface a timeout that the source test hid. This is a GOOD outcome — it surfaces a real latency issue rather than hiding it with a guess.
- **Exact-text assertion coupling:** `toHaveText('Received!')` will break if the server's response copy ever changes (e.g., "Received! Thank you."). The source `assert value == "Received!"` has the same coupling. Mitigation: use `toContainText(/Received/i)` for robustness — left for reviewer to decide per Q4.

## Expected metrics

- **Selector quality score (estimated):** 0.67 (2/3 locators are role/label-based; `#message` is CSS ID — see Q3 for path to 1.0)
- **Smell count delta vs source:** −8 (3 H-severity removed, 4 M-severity removed, 1 L-severity removed; 0 new smells introduced)
- **Source LOC:** 32
- **New test file LOC estimate:** ~22–25 (single test, no POM, no fixture file)
- **LOC delta:** ~−8 to −10
- **Anti-pattern coverage:** 8/8
