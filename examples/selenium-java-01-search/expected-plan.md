# Migration plan: input.spec.ts (Selenium Java -> Playwright TypeScript)

## Source framework
selenium-java

## Summary
Acme Shop site-search behaviour. Two scenarios: a keyword query returns a
visible grid whose first result contains the keyword in its title; and
submitting an empty query shows a hint message asking the user to enter a
search term.

## Anti-patterns detected

Sorted by Severity (H, M, L), then by Line.

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 41 | KB-1.3.1 | hard-wait | `Thread.sleep(2000)` | drop; web-first `toBeVisible()` |
| H | 43 | KB-1.3.15 | expected-conditions-verbose | `EC.visibilityOfElementLocated(...)` | `await expect(locator).toBeVisible()` |
| H | 40 | KB-1.3.2 | xpath-deep | `//header/div[2]/form/button` | `getByRole('button', { name: 'Search' })` |
| H | 56 | KB-1.3.1 | hard-wait | `Thread.sleep(1000)` | drop; web-first `toBeVisible()` |
| H | 58 | KB-1.3.2 | xpath-deep | `//div[contains(@class,'search-hint')]/span[2]` | `page.getByText('Please enter a search term')` |
| M | 49 | KB-1.3.7 | snapshot-list-indexing | `findElements(...).get(0)` | `locator.first()` (auto-retrying) |
| M | 47 | KB-1.3.10 | non-web-first-assertion | `assertTrue(results.size() >= 1, ...)` | `await expect(locator).toBeVisible()` |
| M | 50 | KB-1.3.10 | non-web-first-assertion | `assertTrue(firstTitle.getText()...contains("linen"))` | `await expect(loc).toContainText(/linen/i)` |
| M | 59 | KB-1.3.10 | non-web-first-assertion | `assertEquals("Please enter a search term", ...)` | `await expect(loc).toBeVisible()` (visible text) |
| M | 24-29 | KB-1.3.12 | driver-setup-boilerplate | `@BeforeEach setUp() { driver = new ChromeDriver(); ... }` | drop; `page` fixture |
| M | 31-34 | KB-1.3.12 | manual-driver-quit | `@AfterEach tearDown() { driver.quit(); }` | drop; `page` fixture |
| L | 37,54 | KB-1.3.1 | throws-InterruptedException | `throws InterruptedException` | drop with `Thread.sleep` |

## Locator translation table
| Original | New | Confidence | Notes |
|---|---|---|---|
| `By.id("site-search")` | `page.getByRole('searchbox', { name: 'Search products' })` | medium | An `id="site-search"` input is most likely the search box. Role + accessible name is more semantic. If the input is not labelled, fall back to `getByPlaceholder('Search products')`. |
| `By.xpath("//header/div[2]/form/button")` | `page.getByRole('button', { name: 'Search' })` | high | The form's submit button — role-based locator is the canonical fix for deep XPath. |
| `By.cssSelector(".results-grid")` | `page.getByRole('article').first()` (as proxy) | medium | The original asserts the GRID is visible; the migrated test asserts the first article inside it is visible. Functionally equivalent if results are rendered as articles. Reviewer should confirm. |
| `By.cssSelector(".results-grid .product-card")` | `page.getByRole('article')` | medium | Assumes product cards are `<article>` elements. If they are generic `<div>`s, use `getByTestId('product-card')`. |
| `By.cssSelector(".product-card h3")` (first) | `results.first().getByRole('heading')` | high | Product titles as headings — the standard pattern. |
| `By.xpath("//div[contains(@class,'search-hint')]/span[2]")` | `page.getByText('Please enter a search term')` | high | The visible message is the assertable thing; the XPath is incidental. |

## Hallucination-defense pins

1. **Site-search input** — assumed `getByRole('searchbox', { name: 'Search products' })`. If the input is not `<input type="search">` or lacks an accessible name: keep `By.id("site-search")` → `page.locator('#site-search')`, add WHY-comment `'Q1 unresolved: searchbox role / accessible name'`. Reviewer fallback: ask FE team to set `type="search"` and `aria-label="Search products"`, OR switch to `page.getByPlaceholder('Search products')`.
2. **Results grid (visibility proxy)** — assumed `page.getByRole('article').first()` as the visibility check (first article inside the grid). If results render as generic `<div>`s rather than `<article>`: keep `By.cssSelector(".results-grid")` → `page.locator('.results-grid')`, add WHY-comment `'Q2 unresolved: grid item element type'`. Reviewer fallback: confirm cards are `<article>` OR add `data-testid="results-grid"` on the wrapper.
3. **Product cards** — assumed `page.getByRole('article')`. If cards are generic `<div>`s without role: keep `By.cssSelector(".results-grid .product-card")` → `page.locator('.product-card')`, add WHY-comment `'Q2 unresolved: product-card role'`. Reviewer fallback: switch to `page.getByTestId('product-card')`.

## Structural changes
- Extract POM: no — two short tests; POM would be premature.
- Extract fixture: no — `page` fixture already covers driver setup /
  teardown.
- Split into multiple specs: no.

## Open questions for reviewer
- **Q1**: Is the search box an `<input type="search">` with an accessible name?
  If it is just `<input id="site-search">`, the migrated test will need
  `getByPlaceholder` instead of `getByRole('searchbox')`.
- **Q2**: Are product cards rendered as `<article>` elements? If not, the
  `getByRole('article')` strategy will not work — switch to
  `getByTestId('product-card')`.
- The Selenium test asserts the FIRST title contains "linen". The
  migrated test does the same via `.first()`. If multi-product matching
  matters (e.g. all results should contain the keyword), reviewer should
  ask whether to upgrade the assertion to iterate.

## Risk callouts
- The Selenium test combines `Thread.sleep(2000)` with a `WebDriverWait`
  — the sleep is dead weight masking the wait. Migrated test relies only
  on web-first waits; if the search results actually take > 5 seconds to
  render, bump the default `expect` timeout for this assertion.
- `@AfterEach driver.quit()` is REPLACED by Playwright's automatic
  context teardown via the `page` fixture; no explicit cleanup needed.

## Expected metrics
- Selector quality score: 4/4 role-based (was 0/5 xpath / css).
- Smell count delta: -2 `Thread.sleep`, -1 `WebDriverWait`, -1 snapshot-
  list indexing, -2 JUnit assertions, -1 driver-setup boilerplate.
- LOC delta: 56 → 26 (-30 lines; massive saving because Playwright's
  page fixture replaces all of the setup / teardown machinery).
