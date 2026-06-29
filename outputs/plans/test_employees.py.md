# Migration plan: test_employees.py

## Source framework

**Selenium Python** (selenium 4.x, pytest). Confirmed by: `from selenium.webdriver.common.by import By`, `WebDriverWait`, `expected_conditions as EC`, `@pytest.fixture`, `def test_*` function shape, and `NoSuchElementException` import. No `conftest.py`, `requirements.txt`, or `pages/employees_page.py` were included in the migration input — framework version is estimated as Selenium 4.x (modern `By.*` constant style, not deprecated `find_element_by_id` methods).

**Target**: Playwright TypeScript (latest stable, v1.49+), pwm-blueprint layered architecture (v0.2.0 default).

**Note — sibling file missing:** The source imports `from pages.employees_page import EmployeesPage`. This POM file (`pages/employees_page.py`) is **not present** in the migration input. The actual locators behind `EmployeesPage.search_box` and `EmployeesPage.search_button` are unknown. See Q1–Q2 and all LOW-confidence rows.

---

## Summary

This test suite exercises two independent employee-management features: (1) filtering the employees list by department and navigating from the filtered list to an employee detail page, and (2) verifying that the add-employee form rejects an empty submission with a visible validation error. The source uses `time.sleep` hard waits, snapshot-based `find_elements` list indexing, raw XPath with a CSS-class condition, `driver.page_source` substring assertions, a `try/except NoSuchElementException` presence-check, and a hand-rolled pytest driver fixture — all of which are replaced with Playwright web-first patterns and the pwm-blueprint page-object structure.

### What bug does this catch?

Catches (a) a regression where the department filter fails to narrow the employee list to Engineering rows or clicking a filtered row loses the department context on the detail page, and (b) a regression where the add-employee form silently accepts an empty submission without surfacing a "First name is required" validation error.

### User-perceivable assertion checklist

**Scenario 1.1 — filter by Engineering department:**
- [ ] After typing "Engineering" and triggering the search: at least one employee row is visible in the table (filter is non-empty)
- [ ] After clicking the first filtered row: the detail view contains visible text matching "Department: Engineering"

**Scenario 1.2 — add-employee form rejects empty submission:**
- [ ] After clicking the submit button without filling any fields: a validation error element is visible
- [ ] The validation error element contains the text "First name is required"

---

## Anti-patterns detected

| Severity | Line(s) | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 28 | KB-1.4.16 | `implicitly_wait` global timeout | `drv.implicitly_wait(10)` | Drop entirely; configure `actionTimeout` / `expect.timeout` at project level in `playwright.config.ts` |
| H | 35 | KB-1.4.12 | Hardcoded environment URL | `driver.get("https://staging.example.com/emp…")` | Use `baseURL` from env; `await employeesListPage.open()` calls `page.goto('/employees')` |
| H | 36 | KB-1.4.1 | `time.sleep` hard wait | `time.sleep(2)` | Remove; web-first assertion on first visible table row replaces the sleep |
| H | 46–47 | KB-1.4.17 | `find_elements` snapshot-list — length check | `rows = driver.find_elements(By.XPATH, …); assert len(rows) >= 1` | `await expect(employeesListPage.tableRows).not.toHaveCount(0)` — live locator, polls |
| H | 49 | KB-1.4.17 | `find_elements` snapshot-list — `[0]` index click | `rows[0].click()` | `await employeesListPage.tableRows.first().click()` — live locator, re-resolves per action |
| H | 50 | KB-1.4.1 | `time.sleep` hard wait | `time.sleep(1)` | Remove; `waitForPageLoad()` on the detail page POM waits for a stable element |
| H | 51 | KB-1.4.6 | `page_source` substring assertion | `assert "Department: Engineering" in driver.page_source` | `await expect(employeesDetailPage.textDepartment).toContainText(/Engineering/i)` |
| H | 55 | KB-1.4.12 | Hardcoded environment URL | `driver.get("https://staging.example.com/emp…/new")` | `await employeesNewPage.open()` → `page.goto('/employees/new')` |
| H | 59–63 | KB-1.4.8 | `try/except NoSuchElementException` as presence check | `try: error = driver.find_element(…); assert error.is_displayed()…` | `await expect(employeesNewPage.alertFormError).toBeVisible()` — direct web-first assertion |
| H | 64 | KB-1.4.6 | `page_source` substring assertion | `assert "First name is required" in driver.page_source` | `await expect(employeesNewPage.alertFormError).toContainText(/first name is required/i)` |
| M | 25–30 | KB-1.4.5 | Hand-rolled pytest driver fixture | `@pytest.fixture def driver(): drv = build_driver()…` | Drop; Playwright provides `page` fixture automatically; POMs injected via `base.fixture.ts` |
| M | 38–39 | KB-UNCLASSIFIED | `clear()` + `send_keys()` instead of atomic `fill` | `page.search_box.clear()` / `page.search_box.send_keys(…)` | `await employeesListPage.inputSearch.fill('Engineering')` — `fill()` replaces atomically |
| M | 42–44 | KB-1.4.4 | `WebDriverWait` / `EC` ceremony | `WebDriverWait(driver, 10).until(EC.presence_of_…)` | Drop; Playwright auto-waits on every action and web-first assertion |
| M | 46 | KB-1.4.2 | XPath with CSS-class attribute condition | `By.XPATH, "//table[@class='employees-table']//…"` | `page.locator('table.employees-table tbody tr')` as fallback; prefer `getByRole('row')` if semantic `<table>` confirmed |
| M | 56 | KB-1.4.3 | CSS selector as primary locator for submit button | `By.CSS_SELECTOR, "form button[type='submit']"` | `page.getByRole('button', { name: /add employee\|save\|submit/i })` — role confirmed, accessible name guessed |

### Unclassified smells

- **Lines 38–39 — `search_box.clear()` + `search_box.send_keys()`**: Python/Selenium equivalent of Cypress KB-1.2.30 (`cy.get('input').clear().type()`). No explicit `KB-1.4.*` entry exists for this two-step Python pattern. In Playwright, `locator.fill()` replaces both calls atomically and avoids the React state-race the two-step pattern creates. Reviewer: consider adding a `KB-1.4.*` entry to document this smell for future Selenium Python migrations.
- **Line 61 — `assert error.is_displayed()` inside try block**: Sync `is_displayed()` probe nested inside the KB-1.4.8 try/except. The composite smell is captured under KB-1.4.8; `is_displayed()` specifically is the Python equivalent of Selenium Java's `el.isDisplayed()` (mentioned indirectly in KB-1.3.8), but has no standalone Python KB entry. Catalogued here for completeness.

---

## Locator translation table

**DOM snapshot**: No file at `outputs/dom-snapshots/test_employees.yaml` — proceeding in offline fallback mode. All proposals rely on inferred evidence only; DOM grounding annotations are omitted per the documented fallback procedure.

**Critical**: `EmployeesPage.search_box` and `EmployeesPage.search_button` come from a sibling POM not in the input. Both are marked LOW confidence and pins 1–2 are mandatory reviewer actions.

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.search_box` (EmployeesPage attr) | `page.getByRole('searchbox')` | low | Attr name `search_box` implies a text input; `role="searchbox"` or `<input type="search">` assumed. Fallback: `page.getByPlaceholder(/search\|filter/i)` if no label. See pin 1. |
| `page.search_button` (EmployeesPage attr) | `page.getByRole('button', { name: /search\|filter/i })` | low | Attr name `search_button` implies a clickable button; accessible name unknown without EmployeesPage source. See pin 2. |
| `(By.CSS_SELECTOR, "table.employees-table tbody tr")` (EC wait) | *(dropped)* | n/a | Wait replaced by web-first assertion on the live `tableRows` locator: `await expect(tableRows).not.toHaveCount(0)` |
| `By.XPATH, "//table[@class='employees-table']//tbody//tr"` | `page.locator('table.employees-table tbody tr')` | low | XPath uses CSS-class condition (fragile). CSS fallback preserves selector specificity. Upgrade to `page.getByRole('row')` if reviewer confirms semantic `<table>`. See pin 3. |
| `rows[0]` (snapshot index 0) | `page.locator('table.employees-table tbody tr').first()` | med | `first()` targets a live locator; `first()` is fragile on unstable sort order but better than `[0]` snapshot. Filtering by employee name preferred if stable test data exists. See pin 4. |
| `"Department: Engineering" in driver.page_source` | `page.getByText(/Department:\s*Engineering/i)` | low | `page_source` matches hidden nodes; `getByText` targets visible text only. Detail page DOM unknown — text may be split across label+value elements. See pin 5. |
| `driver.find_element(By.CSS_SELECTOR, "form button[type='submit']")` | `page.getByRole('button', { name: /add employee\|save\|submit/i })` | med | `button[type='submit']` confirms ARIA `role=button`; accessible name unknown, guessed from common add-form patterns. See pin 6. |
| `driver.find_element(By.CSS_SELECTOR, ".form-error")` | `page.getByRole('alert')` | low | `.form-error` is a CSS class; `role="alert"` is the standard convention for live validation errors but is unverified. Fallback: `page.locator('.form-error')`. See pin 7. |
| `"First name is required" in driver.page_source` | `page.getByRole('alert').filter({ hasText: /first name is required/i })` | med | Exact error text "First name is required" is known from the source assertion. Chained on the same alert locator as pin 7; accessible name of the container is uncertain. See pin 7. |

---

## Hallucination-defense pins

1. **Search input (`inputSearch`)** — assumed `page.getByRole('searchbox')`. If DOM contradicts (no `role="searchbox"`, no `<input type="search">`): keep `page.getByPlaceholder(/search|filter/i)` as first fallback, then `page.locator('[data-testid="employee-search"]')` if testid available. Add WHY-comment `'Q1 unresolved: search_box locator from EmployeesPage unavailable'`. Reviewer fallback: read `pages/employees_page.py` in the source repo; supply the actual Selenium `By` strategy and map to highest-priority Playwright locator.

2. **Search/filter button (`buttonSearch`)** — assumed `page.getByRole('button', { name: /search|filter/i })`. If DOM contradicts (icon button with no accessible name, or the search fires on keypress without a separate button): fall back to `page.getByRole('button').filter({ hasText: /search|filter/i })`. Add WHY-comment `'Q2 unresolved: search_button accessible name from EmployeesPage unavailable'`. Reviewer fallback: inspect the button element in the SUT; if no accessible name exists, request `aria-label="Search employees"` from the FE team.

3. **Employee table rows (`tableRows`)** — assumed `page.locator('table.employees-table tbody tr')`. If the CSS class changes or the table uses a non-semantic markup (divs, not `<table>`): use `page.getByTestId('employee-row')` if testid exists, else `page.locator('[data-employee-row]')`. Add WHY-comment `'Q3 unresolved: table class selector may be fragile'`. Reviewer fallback: confirm the class name in the production DOM; request `data-testid="employee-row"` if the table is already a design-system component.

4. **First filtered row** — assumed `page.locator('table.employees-table tbody tr').first()`. If sort order is indeterminate across test runs: filter by a stable accessible name such as `page.getByRole('row').filter({ hasText: /alice|test user/i })` using the seeded employee name. Add WHY-comment `'Q4: using first() because no stable row identifier is known'`. Reviewer fallback: confirm whether engineering employees are seeded with known names; supply the name constant for content-based filtering.

5. **Department text on detail page (`textDepartment`)** — assumed `page.getByText(/Department:\s*Engineering/i)`. If "Department:" label and "Engineering" value are rendered as separate DOM nodes (e.g., `<dt>Department</dt><dd>Engineering</dd>`): use `page.getByRole('definition').filter({ hasText: /engineering/i })` or scope narrower. Add WHY-comment `'Q5 unresolved: detail page DOM structure unknown'`. Reviewer fallback: navigate to an employee detail page in the SUT and inspect how "Department: Engineering" is structured; update the locator to scope to the value element specifically.

6. **Submit button (`buttonSubmit`)** — assumed `page.getByRole('button', { name: /add employee|save|submit/i })`. If the button label matches none of the regex alternates (e.g., it is icon-only with no accessible name): fall back to `page.locator('form button[type="submit"]')` with LOW confidence and add WHY-comment `'Q6: submit button accessible name unverified'`. Reviewer fallback: inspect the submit button in the SUT; if it has no visible label or `aria-label`, request the FE team to add one.

7. **Form validation error (`alertFormError`)** — assumed `page.getByRole('alert')`. If `.form-error` element has no `role="alert"` and `getByRole('alert')` returns nothing: fall back to `page.locator('.form-error')` (MED confidence on CSS class) and add WHY-comment `'Q7 unresolved: .form-error ARIA role unconfirmed'`. Reviewer fallback: inspect `.form-error` in DevTools; if `role="alert"` is absent, ask the FE team to add it (also an a11y improvement).

---

## Structural changes

### Per-file fate

| Source artefact | Fate | Reason |
|---|---|---|
| `test_employees.py` — `def test_filter_by_engineering_department` | KEPT and RESHAPED | Becomes `test(...)` block in `outputs/tests/employees.spec.ts` (scenario 1.1) |
| `test_employees.py` — `def test_add_employee_form_rejects_empty_submission` | KEPT and RESHAPED | Becomes second `test(...)` block in the same spec (scenario 1.2) |
| `@pytest.fixture def driver()` (inline in test file) | DROPPED | Playwright provides `page` fixture automatically; `build_driver()`, `drv.implicitly_wait`, and `drv.quit()` have no equivalents — the framework handles all of this |
| `helpers/driver_factory.py` (imported as `build_driver`) | DROPPED | No driver factory needed; Playwright browser/context lifecycle managed by `playwright.config.ts` and the fixture system |
| `pages/employees_page.py` (`EmployeesPage` POM) | RESHAPED | Selenium POM with `search_box`/`search_button` WebElements → `PageClassEmployeesList` in `outputs/helper/page-object/pages/employees-list.page.ts`. Source unavailable (see Q1–Q2); locators must be validated against the live SUT |

### 5a — Pages

**`outputs/helper/page-object/pages/employees-list.page.ts`** — `PageClassEmployeesList extends BasePage`
- `readonly url = '/employees'`
- Locator fields (type-prefixed, each with `.describe('[LABEL_EMPLOYEES_LIST] …')`):
  - `inputSearch` — search input field (LOW confidence; see pin 1)
  - `buttonSearch` — search/filter trigger button (LOW confidence; see pin 2)
  - `tableRows` — live locator for table rows `table.employees-table tbody tr` (LOW; see pin 3)
- Action methods:
  - `searchByDepartment(department: string): Promise<void>` — fills `inputSearch`, clicks `buttonSearch`, then awaits `tableRows.not.toHaveCount(0)`
  - `clickFirstRow(): Promise<PageClassEmployeesDetail>` — clicks `tableRows.first()`, returns `new PageClassEmployeesDetail(this.page)` with `waitForPageLoad()` awaited
- `waitForPageLoad()` — web-first assertion on the page heading or a stable landmark; NO hard wait

**`outputs/helper/page-object/pages/employees-detail.page.ts`** — `PageClassEmployeesDetail extends BasePage`
- No own `url` (navigated to by clicking a list row; URL is dynamic `/employees/:id`)
- Locator fields:
  - `textDepartment` — `page.getByText(/Department:/i)` as initial stub (LOW confidence; see pin 5). Stage 2 may need to narrow this after reviewer provides DOM evidence
- `waitForPageLoad()` — web-first assertion on a stable heading or the `textDepartment` locator being visible

**`outputs/helper/page-object/pages/employees-new.page.ts`** — `PageClassEmployeesNew extends BasePage`
- `readonly url = '/employees/new'`
- Locator fields:
  - `buttonSubmit` — form submit button (MED confidence; see pin 6)
  - `alertFormError` — validation error container (LOW confidence; see pin 7)
- Action methods:
  - `submitEmptyForm(): Promise<void>` — clicks `buttonSubmit` without filling any fields
- `waitForPageLoad()` — web-first assertion on form heading or `buttonSubmit` visibility

### 5b — Blocks

None. No section on any page reaches 5+ locators or appears on 3+ pages.

### 5c — Fixtures

`outputs/helper/fixtures/base.fixture.ts` **(mutate)** — add three page-object fixture entries:
- `employeesListPage: PageClassEmployeesList` (test-scoped)
- `employeesDetailPage: PageClassEmployeesDetail` (test-scoped)
- `employeesNewPage: PageClassEmployeesNew` (test-scoped)

No additional fixture files required (no auth, no network mocking indicated by source tests).

### 5d — API wrappers

None. Both tests exercise UI flows the tests themselves own. No seeded test data is created via API in the source — the filter test relies on existing staging data (flagged as a risk; see Risk callouts and Q10).

### 5e — Actions

None. The list→detail navigation is a single `clickFirstRow()` action that belongs on `PageClassEmployeesList` (it returns the destination POM). The journey does not compose 2+ pages in a multi-step sequence that warrants its own `helper/actions/` file.

### 5f — Utilities

None. No text parsing required. The "First name is required" comparison is done via web-first `toContainText`.

### 5g — Test-data

`outputs/helper/test-data/labels.ts` **(mutate)** — add:
- `LABEL_EMPLOYEES_LIST = "Employees List"` — `[LABEL]` prefix for EmployeesList page
- `LABEL_EMPLOYEES_DETAIL = "Employee Detail"` — `[LABEL]` prefix for EmployeesDetail page
- `LABEL_EMPLOYEES_NEW = "New Employee"` — `[LABEL]` prefix for EmployeesNew page
- `DEPARTMENT_FILTER_ENGINEERING = "Engineering"` — named constant replacing the magic string `"Engineering"` in the test

### 5h — Types

None. No new API response shapes or internal value objects required.

### 5i — Spec file

`outputs/tests/employees.spec.ts`:
- `import { test, expect } from "@fixtures/base.fixture"`
- `import { DEPARTMENT_FILTER_ENGINEERING, LABEL_EMPLOYEES_LIST, … } from "@test-data/labels"`
- One flat `test.describe("Employees", { tag: ['@e2e'] }, () => { ... })`
- Two `test(...)` calls, each using `test.step()` groupings
- Scenario 1.1 title: `"[EMP-1.1] - Check that filtering by Engineering department shows matching rows and preserves department context on the detail page"` (ticket ID placeholder — see Q11)
- Scenario 1.2 title: `"[EMP-1.2] - Check that the add-employee form surfaces a validation error on empty submission"` (ticket ID placeholder)

### 5j — Split decision

**No split.** Both tests are in the employee-management domain. The combined spec at ~80–90 LOC is well under the 300-LOC threshold. One `test.describe` block covers both scenarios.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/employees-list.page.ts` | Employees list: search input, search button, table rows, row-click navigation → detail POM |
| Page | `outputs/helper/page-object/pages/employees-detail.page.ts` | Employee detail view: department text locator, `waitForPageLoad()` guard |
| Page | `outputs/helper/page-object/pages/employees-new.page.ts` | Add employee form: submit button, form-error locator |
| Block | (none) | No section reaches 5+ locators; no cross-page reuse |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add `employeesListPage`, `employeesDetailPage`, `employeesNewPage` fixtures |
| API | (none) | No data preparation needed; both tests own their UI flows |
| Action | (none) | List→Detail is a single navigation click; stays on list page method |
| Utility | (none) | No text parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | Add `LABEL_EMPLOYEES_LIST`, `LABEL_EMPLOYEES_DETAIL`, `LABEL_EMPLOYEES_NEW`, `DEPARTMENT_FILTER_ENGINEERING` |
| Type | (none) | No new type shapes |
| Spec | `outputs/tests/employees.spec.ts` | The migrated test (2 scenarios) |

---

## Open questions for reviewer

**Q1: What is the actual locator for `EmployeesPage.search_box`?**
Context: line 38 — `page.search_box.clear()`. The `EmployeesPage` POM (`pages/employees_page.py`) is not included in the migration input.
What I assumed: `search_box` resolves to a labeled text input or `<input type="search">`; proposed `getByRole('searchbox')`.
Impact if wrong: Stage 2 generates a locator targeting a non-existent or wrong element; test fails immediately at the fill step.

**Q2: What is the actual locator for `EmployeesPage.search_button`?**
Context: line 40 — `page.search_button.click()`. Same missing POM as Q1.
What I assumed: `search_button` is a `<button>` with an accessible name containing "search" or "filter".
Impact if wrong: wrong button clicked; filter never fires; the subsequent row count assertion may pass vacuously (0 rows might still satisfy "not.toHaveCount(0)" if the table is pre-populated) or fail with a confusing error.

**Q3: Is the employee list rendered as a semantic `<table>` element?**
Context: lines 43, 46 — CSS selector `table.employees-table tbody tr` and XPath `//table[@class='employees-table']//tbody//tr`.
What I assumed: the employee list is a semantic HTML table, so `<tr>` rows carry `role="row"` implicitly.
Impact if wrong: `getByRole('row')` returns nothing; CSS fallback `locator('table.employees-table tbody tr')` used; if the markup changes, the locator breaks.

**Q4: Is the first filtered row guaranteed to be a stable click target?**
Context: line 49 — `rows[0].click()`. The test filters by "Engineering" then clicks position 0.
What I assumed: any Engineering-department row is an acceptable click target (the department text is what we assert on the detail page).
Impact if wrong: if the sort order is random and some rows belong to a different department (filter bug), the test may pass even though the wrong row was clicked (detail page might show a different department). Should the test filter by a known employee name for determinism?

**Q5: How is "Department: Engineering" rendered on the employee detail page?**
Context: line 51 — `assert "Department: Engineering" in driver.page_source`. No DOM snapshot or POM for the detail page is available.
What I assumed: visible text matching `/Department:\s*Engineering/i` exists as a contiguous string (or close enough for `toContainText`).
Impact if wrong: if "Department:" and "Engineering" are separate elements (e.g., `<dt>Department</dt><dd>Engineering</dd>`), `getByText(/Department:\s*Engineering/i)` returns nothing; need to scope to the `<dd>` element specifically.

**Q6: What is the submit button's accessible name on the `/employees/new` form?**
Context: line 56 — `By.CSS_SELECTOR, "form button[type='submit']"`.
What I assumed: the button label is one of: "Add Employee", "Save", or "Submit".
Impact if wrong: Stage 2's regex `/add employee|save|submit/i` won't match; falls back to `page.locator('form button[type="submit"]')` which is fragile on forms with multiple submit buttons.

**Q7: Does the `.form-error` element carry `role="alert"`?**
Context: lines 60, 64 — `By.CSS_SELECTOR, ".form-error"` and `"First name is required" in driver.page_source`.
What I assumed: `.form-error` has `role="alert"` (standard live-region convention for inline validation errors).
Impact if wrong: `getByRole('alert')` returns nothing; fallback to `locator('.form-error')` ties the test to the CSS class name, which may change on design-system updates.

**Q8: Should the two scenarios live in one spec file or be split?**
Context: `test_filter_by_engineering_department` and `test_add_employee_form_rejects_empty_submission` cover related but distinct pages (`/employees` vs `/employees/new`).
What I assumed: one spec file (`employees.spec.ts`) with one `test.describe("Employees")` block is correct; both tests are under 300 combined LOC.
Impact if wrong: if the team treats the list and the add-form as separate features (separate TestRail suites, separate ownership), split into `employees-list.spec.ts` and `employees-new.spec.ts`.

**Q9: What is the `baseURL` for the employees app?**
Context: lines 35, 55 — `driver.get("https://staging.example.com/employees")`. The hostname `staging.example.com` is a placeholder.
What I assumed: `process.env.BASE_URL` in `playwright.config.ts` is set to the correct environment URL.
Impact if wrong: tests run against the wrong host; failures are environment-specific and misleading.

**Q10: Does the staging environment contain Engineering employees?**
Context: Scenario 1.1 asserts that filtering by "Engineering" yields ≥1 row. The source test makes the same assumption implicitly.
What I assumed: staging data includes at least one Engineering employee.
Impact if wrong: the filter assertion `not.toHaveCount(0)` fails spuriously on a fresh/empty environment; consider a pre-test API fixture (per pwm-blueprint §5d) to seed an Engineering employee.

**Q11: Are there existing ticket IDs to reference in test titles?**
Context: test titles must follow `[TICKET-ID] - Check that <outcome>` per `migration-rules.md`. No ticket IDs are visible in the source.
What I assumed: placeholder IDs `[EMP-1.1]` and `[EMP-1.2]` are acceptable for now.
Impact if wrong: if the project uses a different ID scheme (JIRA, Linear, TestRail), update the prefix in the spec titles to match.

---

## Risk callouts

- **Flake: staging data dependency.** Scenario 1.1 relies on Engineering employees existing in the staging database at test time. If staging is periodically wiped, the filter assertion fails spuriously with no product regression signal. Mitigation (future, not in scope of this migration): add an API fixture to seed one Engineering employee before the test and clean up after.

- **Flake: indeterminate row order.** `tableRows.first()` clicks whichever row appears first after filtering. If the table sort order is random or pagination is involved, a different employee may be clicked on each run. The department assertion should still hold (all filtered rows are Engineering), but if the filter ever lets a non-Engineering row through, this test may not catch it. Consider filtering by a stable test-data employee name (see Q4).

- **Behavioural drift: `page_source` → visible text.** The source asserts `"Department: Engineering" in driver.page_source`, which matches text anywhere in the raw HTML — including script blocks, hidden `aria-*` attributes, and meta tags. The Playwright migration asserts on visible, rendered text via `toContainText`. This is **strictly tighter** and will expose failures the original test silently ignored (e.g., the text is in a hidden element). Reviewer must confirm that "Department: Engineering" appears visibly on the detail page.

- **Flake: `try/except` removal timing.** The source used `try/except NoSuchElementException` because Selenium has no built-in retry on presence checks. Playwright's `await expect(alertFormError).toBeVisible()` has auto-retry up to `expect.timeout` (default 5s). If the validation error is triggered by a backend round-trip taking >5s, the assertion will time out. If this is known to be slow, Stage 2 should document it with an explicit per-assertion timeout override and a `// Walk-and-Watch` comment.

- **Flake: detail page navigation race.** The source `time.sleep(1)` after `rows[0].click()` was an implicit acknowledgment that the detail page takes time to render. Playwright's `waitForPageLoad()` on `PageClassEmployeesDetail` covers this via a web-first assertion on a stable element — but if the detail page performs JS-driven content injection after initial paint, the `waitForPageLoad()` assertion must target the **final stable** element, not an element that appears immediately in a loading state.

- **Missing POM source.** `pages/employees_page.py` is not in the migration input. If Stage 2 generates locators based on plan pins 1–2 and they are wrong, the generated test will fail at the very first action (filling the search box). This is the highest-priority risk item for the reviewer: validate Q1 and Q2 before merging the Stage 2 output.

---

## Expected metrics

- **Selector quality score (estimated)**: 0.60 (5/8 target locators expected to be role/label/text-based; 3/8 fall back to CSS or `locator()` due to missing DOM evidence from the EmployeesPage source and the detail page structure)
- **Smell count delta**: −15 (2 hard waits, 1 `implicitly_wait`, 2 hardcoded URLs, 1 `WebDriverWait`/EC, 1 XPath, 3 snapshot-list operations, 2 `page_source` assertions, 1 `try/except` presence check, 1 pytest fixture pattern, 1 `clear()`+`send_keys()` clear-then-type)
- **LOC delta**: +210 (source: ~66 LOC; target: spec ~85 LOC + 3 page objects ~165 LOC + fixture/label additions ~25 LOC = ~275 LOC total output)
- **Anti-pattern coverage**: 15/15
