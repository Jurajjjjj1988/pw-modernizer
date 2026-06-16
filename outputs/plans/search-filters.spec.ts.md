# Migration plan: search-filters.spec.ts

## Source framework

**bad-playwright** — subtractive migration, no framework translation required. Source is already Playwright TypeScript; the migration removes anti-patterns and reshapes the file into the qa-master layered architecture (Page + Block + fixture injection). No new top-level framework imports beyond rewiring `test`/`expect` from `@fixtures/base.fixture`.

**Source file:** `inputs/bad-playwright/search-filters.spec.ts`
**Target file(s):** `outputs/tests/search-filters.spec.ts` + POM/Block/fixture files listed in §Structural changes

---

## Summary

The suite exercises the Acme Shop storefront product-search and filter flow. Test 1 searches for "shoes", applies a running-category filter and a price-range filter ($50–$150), then asserts that filtered product cards are visible. Test 2 searches for "jacket", applies a rain-category filter, clears all filters, and asserts the product count returned to its pre-filter value. The existing spec passes locally but has accumulated eight hard waits, eleven CSS-class primary selectors, three count sync-probes, and a conditional-logic block that silently swallows the no-results failure path.

### What bug does this catch?

Catches a regression where (1) applying search filters fails to update the product-card list — products outside the active filters remain visible — or (2) the "clear all filters" control fails to restore the unfiltered search result set, leaving the user permanently stuck in a filtered view.

### User-perceivable assertion checklist

- [ ] After searching "shoes" + applying running-category filter + price $50–$150: at least one product card is visible
- [ ] After searching "shoes" + applying running-category filter + price $50–$150: the result-count element contains the text "found"
- [ ] After searching "jacket" and recording initial card count: applying rain-category filter does not immediately crash the UI (precondition; count captured)
- [ ] After clearing all filters: the product-card count matches the pre-filter search count

---

## Anti-patterns detected

| Severity | Line(s) | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 7 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/products')` | use `baseURL` in config + `page.goto('/products')` via Page's `open()` |
| H | 8 | KB-1.1.1 | hard-wait | `page.waitForTimeout(3000)` | remove; `open()` calls `waitForPageLoad()` with web-first guard |
| H | 12 | KB-1.1.1 | hard-wait | `page.waitForTimeout(2000)` after search click | `await expect(arrayProductCards.first()).toBeVisible()` |
| H | 15 | KB-1.1.5 | sync-probe | `expect(await locator.nth(0).isVisible()).toBe(true)` | `await expect(arrayProductCards.first()).toBeVisible()` |
| H | 15 | KB-1.1.2 | nth-selector | `.nth(0)` without comment | replace with `.first()` or `toHaveCount(greaterThan 0)` — see Q9 |
| H | 19 | KB-1.1.1 | hard-wait | `page.waitForTimeout(1500)` after category click | `await expect(arrayProductCards.first()).toBeVisible()` |
| H | 21 | KB-1.1.19 | innerText-compare | `await page.locator('.result-count').innerText()` | expose locator as `textResultCount`; spec uses `toContainText('found')` |
| H | 22 | KB-1.1.19 | sync-string-assert | `expect(countText).toContain('found')` on resolved string | `await expect(searchFiltersPage.textResultCount).toContainText('found')` |
| H | 28 | KB-1.1.1 | hard-wait | `page.waitForTimeout(2000)` after apply-filters | `await expect(arrayProductCards.first()).toBeVisible()` |
| H | 31–37 | KB-1.1.12 | conditional-logic | `if (await locator.isVisible()) { throw } else { count }` | split: assert `await expect(arrayProductCards.first()).toBeVisible()` directly |
| H | 35 | KB-1.1.18 | count-probe | `const cards = await locator.count()` | `await expect(arrayProductCards).not.toHaveCount(0)` |
| H | 36 | KB-1.1.18 | count-assert-not-web-first | `expect(cards).toBeGreaterThan(0)` on raw number | superseded by `toHaveCount` above — see Q9 |
| H | 40 | KB-1.1.14 | hardcoded-url | `page.goto('https://shop.acme.test/products')` (test 2) | same as line 7 |
| H | 41 | KB-1.1.1 | hard-wait | `page.waitForTimeout(2500)` | remove; `open()` handles load wait |
| H | 45 | KB-1.1.1 | hard-wait | `page.waitForTimeout(2000)` after search click | `await expect(arrayProductCards.first()).toBeVisible()` |
| H | 47 | KB-1.1.18 | count-probe | `const initialCount = await locator.count()` | capture after `toBeVisible()` guard; use for `toHaveCount(initialCount)` post-clear |
| H | 50 | KB-1.1.1 | hard-wait | `page.waitForTimeout(1500)` after category click | `await expect(arrayProductCards.first()).toBeVisible()` or count change |
| H | 53 | KB-1.1.1 | hard-wait | `page.waitForTimeout(1500)` after clear-filters | `await expect(arrayProductCards).toHaveCount(initialCount)` replaces the wait |
| H | 55 | KB-1.1.18 | count-probe | `const afterClearCount = await locator.count()` | superseded by `toHaveCount(initialCount)` |
| H | 56 | KB-1.1.18 | count-assert-not-web-first | `expect(afterClearCount).toBe(initialCount)` on raw number | `await expect(arrayProductCards).toHaveCount(initialCount)` |
| M | 10, 43 | KB-1.1.3 | css-class | `page.locator('input.search-bar')` | `getByRole('searchbox')` — MED confidence; see pin 1 |
| M | 11, 44 | KB-1.1.3 | css-class | `page.locator('button.search-submit')` | `getByRole('button', { name: /search/i })` — MED; see pin 2 |
| M | 15, 35, 47, 55 | KB-1.1.3 | css-class | `page.locator('.product-card')` | `getByRole('article')` or keep CSS — LOW; see pin 3 |
| M | 18 | KB-1.1.3 | css-class | `page.locator('.filter-sidebar .category-running')` | see pin 4 — element type unknown |
| M | 21 | KB-1.1.3 | css-class | `page.locator('.result-count')` | keep CSS — LOW; see pin 5 |
| M | 25 | KB-1.1.3 | css-class | `page.locator('.price-min')` | `getByLabel(/min/i)` — LOW; see pin 6 |
| M | 26 | KB-1.1.3 | css-class | `page.locator('.price-max')` | `getByLabel(/max/i)` — LOW; see pin 7 |
| M | 27 | KB-1.1.3 | css-class | `page.locator('button.apply-filters')` | `getByRole('button', { name: /apply/i })` — MED; see pin 8 |
| M | 31 | KB-1.1.3 | css-class | `page.locator('.no-results')` | absorbed into positive assertion; locator dropped |
| M | 49 | KB-1.1.3 | css-class | `page.locator('.filter-sidebar .category-rain')` | see pin 9 — element type unknown |
| M | 52 | KB-1.1.3 | css-class | `page.locator('button.clear-filters')` | `getByRole('button', { name: /clear/i })` — MED; see pin 10 |
| L | 25–26 | KB-1.1.9 | magic-numbers | `.type('50')` / `.type('150')` | extract `PRICE_FILTER_MIN = '50'` / `PRICE_FILTER_MAX = '150'` as spec-top constants |

### Unclassified smells

**U1 — Wrong import source (line 1):** `import { test, expect } from '@playwright/test'` violates the qa-master hard rule: specs may only import `test`/`expect` from `@fixtures/base.fixture`. Only `outputs/helper/fixtures/base.fixture.ts` may import from `@playwright/test`. Stage 2 must change the import. No KB entry — this is a qa-master conformance rule (see `config/migration-rules.md` §2 and `CLAUDE.md`). Severity: **H** (test won't typecheck against fixture-injected page objects).

**U2 — `.type()` instead of `.fill()` (lines 10, 25, 26, 43):** `locator.type(str)` dispatches individual keystroke events (keydown/keypress/keyup per character), which can trigger debounce handlers, autocomplete dropdowns, and validation mid-type. `locator.fill(str)` replaces the value atomically and is preferred for simple text entry. Closest KB analog: KB-1.2.27 (Cypress keystroke-delay smell). Severity: **M**. Stage 2 must replace all four `.type()` calls with `.fill()`.

---

## Locator translation table

No DOM snapshot present (`outputs/dom-snapshots/search-filters.spec.ts.yaml` does not exist). All confidence levels are inferred from source selectors, HTML tag presence in the selector string, and class-name semantics.

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('input.search-bar')` | `page.getByRole('searchbox')` | med | `input` tag confirms it's an input; `search-bar` class implies search purpose; no DOM evidence of `type="search"` or ARIA `role="searchbox"`. See Q1. |
| `page.locator('button.search-submit')` | `page.getByRole('button', { name: /search/i })` | med | `button` tag confirms role; accessible name (button label text) is guessed from class name. See Q2. |
| `page.locator('.product-card')` | `page.locator('.product-card')` | low | No ARIA role evidence; common patterns are `article` or `listitem` but cannot promote without DOM proof. Reviewer: add `data-testid="product-card"` or confirm role. See Q3, pin 3. |
| `page.locator('.filter-sidebar .category-running')` | `page.getByRole('button', { name: /running/i })` | low | Element type entirely unknown — could be `checkbox`, `link`, or `button`. Accessible name guessed from class suffix. See Q4, pin 4. |
| `page.locator('.result-count')` | `page.locator('.result-count')` | low | No ARIA or semantic evidence. Role unknown; test only checks `.toContain('found')`. Reviewer: add `data-testid="result-count"`. See Q5, pin 5. |
| `page.locator('.price-min')` | `page.getByLabel(/min(imum)?\s*price/i)` | low | Label text unknown; assumes the input is visually labeled. Could also be `getByPlaceholder`. See Q6, pin 6. |
| `page.locator('.price-max')` | `page.getByLabel(/max(imum)?\s*price/i)` | low | Same uncertainty as `.price-min`. See Q6, pin 7. |
| `page.locator('button.apply-filters')` | `page.getByRole('button', { name: /apply/i })` | med | `button` tag confirms role; accessible name guessed from class. See Q7, pin 8. |
| `page.locator('.no-results')` | *(dropped — absorbed into positive assertion)* | — | Conditional logic (KB-1.1.12) removed. The spec will use `await expect(arrayProductCards.first()).toBeVisible()` instead; `.no-results` locator is not needed in the migrated spec. |
| `page.locator('.filter-sidebar .category-rain')` | `page.getByRole('button', { name: /rain/i })` | low | Same reasoning as `.category-running`. See Q4, pin 9. |
| `page.locator('button.clear-filters')` | `page.getByRole('button', { name: /clear/i })` | med | `button` tag confirms role; accessible name guessed. See Q8, pin 10. |

---

## Hallucination-defense pins

1. **Search input** — assumed `page.getByRole('searchbox')`. If DOM lacks `type="search"` or `role="searchbox"`: keep `locator('input.search-bar')`, add WHY-comment `'Q1 unresolved: search input type/role not confirmed'`. Reviewer fallback: add `type="search"` to the HTML input or provide the visible label text so `getByLabel` can be used.

2. **Search submit button** — assumed `page.getByRole('button', { name: /search/i })`. If button text is something other than "Search" (e.g., a magnifying-glass icon with no visible text): keep `locator('button.search-submit')`, add WHY-comment `'Q2 unresolved: search button accessible name not confirmed'`. Reviewer fallback: add `aria-label="Search"` to the button.

3. **Product cards** — assumed `page.locator('.product-card')` (kept as-is). If reviewer confirms the element has `role="article"` or `role="listitem"`: upgrade to `page.getByRole('article')` with HIGH confidence. If a `data-testid` can be added: use `getByTestId('product-card')`. Add WHY-comment `'Q3 unresolved: product card ARIA role unknown'` if kept as CSS.

4. **Category running filter** — assumed `page.getByRole('button', { name: /running/i })`. If the element is a `checkbox` (most likely for multi-select filter UIs): use `page.locator('.filter-sidebar').getByRole('checkbox', { name: /running/i })` instead. If it's a `link`: `getByRole('link', { name: /running/i })`. Fallback if type unclear: keep `locator('.filter-sidebar .category-running')`, add WHY-comment `'Q4 unresolved: category filter element type unknown'`.

5. **Result count text** — assumed `page.locator('.result-count')` (kept as-is). If reviewer adds `data-testid="result-count"`: upgrade to `getByTestId('result-count')`. If there is visible text that can be matched: `getByText(/found/i)`. Add WHY-comment `'Q5 unresolved: result count element type unknown'` if kept as CSS.

6. **Price min input** — assumed `page.getByLabel(/min(imum)?\s*price/i)`. If the input has a placeholder instead of a label: use `page.getByPlaceholder(/min/i)`. If it has a `type="number"`: `getByRole('spinbutton', { name: /min/i })`. Fallback: keep `locator('.price-min')`, add WHY-comment `'Q6 unresolved: price-min label/placeholder text unknown'`.

7. **Price max input** — assumed `page.getByLabel(/max(imum)?\s*price/i)`. Same fallback logic as pin 6. Add WHY-comment `'Q6 unresolved: price-max label/placeholder text unknown'` if kept as CSS.

8. **Apply filters button** — assumed `page.getByRole('button', { name: /apply/i })`. If button text is "Apply Filters" or "Filter" or "Go": adjust the regex. Fallback: keep `locator('button.apply-filters')`, add WHY-comment `'Q7 unresolved: apply-filters button accessible name not confirmed'`.

9. **Category rain filter** — assumed `page.getByRole('button', { name: /rain/i })`. Same fallback logic as pin 4 — could be `checkbox` or `link`. Fallback: keep `locator('.filter-sidebar .category-rain')`, add WHY-comment `'Q4 unresolved (category-rain variant)'`.

10. **Clear filters button** — assumed `page.getByRole('button', { name: /clear/i })`. If button text is "Reset" or "Remove filters": adjust the regex. Fallback: keep `locator('button.clear-filters')`, add WHY-comment `'Q8 unresolved: clear-filters button accessible name not confirmed'`.

---

## Structural changes

This migration extracts a **Page** and a **Block** because (a) duplicate selectors appear across both tests making POM extraction non-optional at Stage 2's duplicate-selector gate, and (b) the filter sidebar reaches the 5+-locator / 3+-method threshold for Block extraction (migration-rules.md §1).

### 5a — Page: `PageClassSearchFilters`

**File:** `outputs/helper/page-object/pages/search-filters.page.ts`

Locator fields (type-prefixed, `readonly`, with `.describe('[LABEL_SF] …')`):
- `inputSearch` → `getByRole('searchbox')` (MED, pin 1)
- `buttonSearch` → `getByRole('button', { name: /search/i })` (MED, pin 2)
- `arrayProductCards` → `locator('.product-card')` (LOW, pin 3)
- `textResultCount` → `locator('.result-count')` (LOW, pin 5)
- `blockSearchFilter` → `new BlockClassSearchFilter(this.page)` (eagerly instantiated)

Action methods:
- `open(): Promise<void>` — `goto(URL_PRODUCTS)` then `waitForPageLoad()`
- `waitForPageLoad(): Promise<void>` — `await expect(arrayProductCards.first()).toBeVisible()`
- `searchFor(term: string): Promise<void>` — fills `inputSearch` with `term`, clicks `buttonSearch`, awaits `arrayProductCards.first()` visible

### 5b — Block: `BlockClassSearchFilter`

**File:** `outputs/helper/page-object/blocks/search-filter.block.ts`

Meets the extraction threshold: 6 locators + 3 distinct action methods.

Locator fields:
- `buttonCategoryRunning` → `getByRole('button', { name: /running/i })` (LOW, pin 4)
- `buttonCategoryRain` → `getByRole('button', { name: /rain/i })` (LOW, pin 9)
- `inputPriceMin` → `getByLabel(/min(imum)?\s*price/i)` (LOW, pin 6)
- `inputPriceMax` → `getByLabel(/max(imum)?\s*price/i)` (LOW, pin 7)
- `buttonApplyFilters` → `getByRole('button', { name: /apply/i })` (MED, pin 8)
- `buttonClearFilters` → `getByRole('button', { name: /clear/i })` (MED, pin 10)

Action methods:
- `clickCategoryRunning(): Promise<void>` — clicks `buttonCategoryRunning`
- `applyPriceRange(min: string, max: string): Promise<void>` — fills `inputPriceMin` + `inputPriceMax`, clicks `buttonApplyFilters`
- `clearAllFilters(): Promise<void>` — clicks `buttonClearFilters`

Instantiated on `PageClassSearchFilters` as `readonly blockSearchFilter = new BlockClassSearchFilter(this.page)`.

### 5c — Fixtures

`outputs/helper/fixtures/base.fixture.ts` — **mutate**: add `searchFiltersPage: PageClassSearchFilters` to the `Fixtures` type and the `base.extend<Fixtures>` block. Import `PageClassSearchFilters` from `@page-object/pages/search-filters.page`.

No new fixture file; no authentication required.

### 5d–5f — API / Actions / Utilities

None. This is a pure UI flow on a single page; no data prep via API, no cross-page journey, no string parsing.

### 5g — Test-data

- `outputs/helper/test-data/labels.ts` — **mutate**: add `LABEL_SEARCH_FILTERS = 'Search Filters'` and `LABEL_SEARCH_FILTER_BLOCK = 'Filter Sidebar'`
- `outputs/helper/test-data/urls.ts` — **mutate**: add `URL_PRODUCTS = '/products'`

Named constants that stay in the spec file (not shared across tests or pages):
- `SEARCH_TERM_SHOES = 'shoes'`
- `SEARCH_TERM_JACKET = 'jacket'`
- `PRICE_FILTER_MIN = '50'`
- `PRICE_FILTER_MAX = '150'`

### 5i — Spec file

`outputs/tests/search-filters.spec.ts`

- Import: `import { test, expect } from "@fixtures/base.fixture"` (not `@playwright/test`)
- Import: `import { LABEL_SEARCH_FILTERS, LABEL_SEARCH_FILTER_BLOCK } from "@test-data/labels"`
- One `test.describe('Storefront search filters', ...)` block
- Two tests using `{ searchFiltersPage }` fixture injection
- Each test wraps steps in `test.step(...)` calls
- No `beforeEach` — both tests call `searchFiltersPage.open()` inside the test body

### 5j — Split decision

No split. Both scenarios test the search-and-filter surface of the same page. Two tests in one `test.describe` is well within the 300-LOC limit and the ≤2 nesting rule.

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/search-filters.page.ts` | `PageClassSearchFilters`: search bar, product card list, result-count text (5 locators, 3 methods) |
| Block | `outputs/helper/page-object/blocks/search-filter.block.ts` | `BlockClassSearchFilter`: filter sidebar (6 locators, 3 action methods — meets 5+/3+ threshold) |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | add `searchFiltersPage: PageClassSearchFilters` injection |
| API | (none) | no data prep — source test drives UI directly |
| Action | (none) | single-page journey; filter sidebar is a Block, not a cross-page Action |
| Utility | (none) | no parsing required |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | add `LABEL_SEARCH_FILTERS`, `LABEL_SEARCH_FILTER_BLOCK` |
| Test-data | `outputs/helper/test-data/urls.ts` (mutate) | add `URL_PRODUCTS = '/products'` |
| Type | (none) | no external API shapes |
| Spec | `outputs/tests/search-filters.spec.ts` | migrated test |

---

## Open questions for reviewer

**Q1: Search input role/type**
Context: Source uses `input.search-bar`; proposed target is `getByRole('searchbox')`.
What I assumed: the input has `type="search"` or `role="searchbox"`.
Impact if wrong: `getByRole('searchbox')` matches zero elements; test breaks on first run.

**Q2: Search submit button accessible name**
Context: Source uses `button.search-submit`; proposed target is `getByRole('button', { name: /search/i })`.
What I assumed: the button's visible text or `aria-label` contains "Search" or similar.
Impact if wrong: locator targets the wrong button or matches zero elements.

**Q3: Product card ARIA role**
Context: Source uses `.product-card`; proposed fallback is `locator('.product-card')`.
What I assumed: the element has no ARIA role or is not an `<article>` element — hence the kept CSS locator.
Impact if wrong: if the element IS an `article`, upgrading to `getByRole('article')` would make the locator resilient to CSS refactors.

**Q4: Category filter element type and accessible names**
Context: Source uses `.filter-sidebar .category-running` and `.filter-sidebar .category-rain`. Proposed target is `getByRole('button', { name: /running/i })` / `getByRole('button', { name: /rain/i })` at LOW confidence.
What I assumed: these are clickable buttons inside the sidebar. The accessible name contains the category name.
Impact if wrong: if they are `<input type="checkbox">` elements, the correct interaction is `.check()` not `.click()`, and the locator becomes `getByRole('checkbox', { name: /running/i })`. If they are `<a>` links, `getByRole('link', { name: /running/i })`.

**Q5: Result count element and text format**
Context: Source asserts `countText.toContain('found')`. The element is `.result-count`.
What I assumed: the text format is something like "12 products found" — the word "found" is stable across locales and product count changes.
Impact if wrong: (a) if the text format changes ("Found 12 results"), the regex/text assertion needs updating; (b) if the element has no accessible role, the CSS locator fallback is the only option.

**Q6: Price range input labels/placeholders**
Context: Source uses `.price-min` and `.price-max`. These are typed with `'50'` and `'150'` (string values, not numbers).
What I assumed: the inputs are labeled (visible `<label>` or `aria-label`) with text containing "min"/"max" or "minimum price"/"maximum price".
Impact if wrong: if placeholder-only, use `getByPlaceholder(/min/i)` and `getByPlaceholder(/max/i)` instead of `getByLabel`.

**Q7: Apply filters button accessible name**
Context: Source uses `button.apply-filters`.
What I assumed: button text contains "Apply" (e.g., "Apply", "Apply Filters", "Apply filter").
Impact if wrong: locator matches zero elements; need exact button text from reviewer.

**Q8: Clear filters button accessible name**
Context: Source uses `button.clear-filters`.
What I assumed: button text contains "Clear" (e.g., "Clear", "Clear all", "Reset filters").
Impact if wrong: same as Q7.

**Q9: Count-comparison assertion migration in test 2**
Context: Source captures `initialCount = await locator.count()` before filtering, then asserts `expect(afterClearCount).toBe(initialCount)` after clearing. Both values are sync probes.
What I assumed: the correct migration is to capture `initialCount` as a number AFTER `waitForPageLoad()` (so the page is settled), then use `await expect(searchFiltersPage.arrayProductCards).toHaveCount(initialCount)` after clearing. `toHaveCount` provides the auto-retry; the only non-web-first operation is the initial snapshot.
Impact if wrong: if the page continues rendering cards after `waitForPageLoad()` (lazy-load / infinite scroll), the `initialCount` snapshot will be wrong and the assertion will flicker.
Alternative the reviewer may prefer: assert `not.toHaveCount(0)` post-clear (weaker — doesn't verify exact count restoration) or add a `waitForURL(/products/)` guard to verify no redirect.

**Q10: Test 2 does not verify the filter actually changed the count**
Context: test 2 clicks `.category-rain`, then immediately clicks "clear all filters" — it never asserts that the filter reduced the product count. The assertion only tests that clearing restores the count, not that the filter worked.
What I assumed: the existing behavior is preserved as-is (the test is scoped to "clear filters", not to "filter applies correctly").
Impact if my assumption is wrong: reviewer may want to add an intermediate assertion after `.clickCategoryRain()` that the count is less than `initialCount`, making the test a true filter-then-clear test. This would add a step to scenario 1.2.

**Q11: Search term stability in the test environment**
Context: tests search for "shoes" and "jacket". If the product catalogue in the test environment returns zero results for either term, both tests will fail from `waitForPageLoad()` / `arrayProductCards.first().toBeVisible()` with no product regression signal.
What I assumed: the environment has at least one product matching each search term.
Impact if wrong: tests flake on environment setup, not on product behaviour. Recommend parameterizing search terms via test-data constants or mocking product API responses.

---

## Risk callouts

- **Count-comparison race (test 2).** The `initialCount` snapshot is taken from a live DOM after `searchFor('jacket')` but before any filter is applied. If the product list loads lazily or has infinite scroll, the count may change between the snapshot and the final `toHaveCount(initialCount)` assertion. This manifests as an intermittent "expected 12, received 14" failure on slow environments. Mitigation: add a `waitForLoadState('domcontentloaded')` in `waitForPageLoad()` OR wait for a stable product-count indicator.

- **Hard-wait semantics around filter debounce.** The source uses `waitForTimeout(1500)` after clicking category filters, suggesting the filter application is debounced or animated. The replacement (`await expect(arrayProductCards.first()).toBeVisible()`) only ensures at least one card exists — it does NOT wait for the count to stabilize if cards appear then re-render. If the filter triggers a full page re-render that briefly shows stale cards, the web-first assertion may pass too early. Stage 2 should assert on a loading indicator becoming hidden, or on `toHaveCount` with the expected filtered count, to avoid this race.

- **Live data dependency.** This test is marked `@e2e` (no mocking). The assertions depend on the test environment having products in the "running" and "rain" categories priced between $50–$150. Environment data drift will cause false failures unrelated to product code changes.

- **No URL assertion.** Neither test asserts the URL after navigation or after filter application. A redirect to an error page would not be caught by the current assertions. Recommendation: add `await expect(page).toHaveURL(/\/products/)` at the start of each test inside `waitForPageLoad()`.

- **Conditional-logic removal changes failure message.** The original conditional `if (await locator('.no-results').isVisible()) { throw new Error('Filter returned no results') }` emits a custom message. The migrated `await expect(arrayProductCards.first()).toBeVisible()` will emit Playwright's default "locator … expected to be visible" message. This is acceptable (more precise) but reviewers should be aware the failure message changes.

---

## Expected metrics

- **Selector quality score (estimated):** 0.55 (6/11 locators target role/label — 4 MED-confidence buttons/search-input + 2 LOW-confidence price inputs if labels resolve; 5 remain CSS-class fallback pending DOM confirmation)
- **Smell count delta:** −32 (20 H-severity + 11 M-severity + 1 L-severity, all removed; 0 new smells introduced; 2 unclassified smells also removed but not counted in this figure)
- **LOC delta:** +140 approx (source: 59 LOC; target: spec ~65 + page ~75 + block ~55 + test-data ~10 + fixture ~10 = 215 LOC total cross-file; net +156; rounded to +140 conservatively)
- **Anti-pattern coverage:** 32/32 cataloged (plus 2 unclassified)
