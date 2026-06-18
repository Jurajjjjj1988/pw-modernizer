# Migration plan: ExplicitWaitJupiterTest.java

## Source framework

**selenium-java** — JUnit Jupiter 5 (`@Test`, `@BeforeEach`, `@AfterEach` from `org.junit.jupiter.api.*`),
Selenium WebDriver 4 (`org.openqa.selenium.*`; `getDomProperty` is a Selenium 4+ API),
`WebDriverWait` + `ExpectedConditions` (`org.openqa.selenium.support.ui.*`),
WebDriverManager (`io.github.bonigarcia.wdm.WebDriverManager`) for automatic ChromeDriver provisioning.
AssertJ (`org.assertj.core.api.Assertions.assertThat`) as the assertion library.

**Target:** Playwright TypeScript, latest stable (v1.x, 2026 conventions), qa-master v0.2.0 layered architecture.

**Input:** single file `ExplicitWaitJupiterTest.java` (~61 LOC including license header).

Per-file fate (single file input):

| Source file | Fate | Reason |
|---|---|---|
| `ExplicitWaitJupiterTest.java` | KEPT and RESHAPED → `outputs/tests/explicit-wait-jupiter-test.spec.ts` + `outputs/helper/page-object/pages/loading-images.page.ts` | `@Test` method → one `test(...)` call; `@BeforeEach`/`@AfterEach` driver lifecycle → DROPPED (Playwright `page` fixture); `WebDriverWait`/`ExpectedConditions` → DROPPED (web-first assertion); `WebDriverManager` → DROPPED (Playwright bundled browser management) |

---

## Summary

This test exercises dynamic image loading: it navigates to a demo page that adds `<img>` elements to the DOM asynchronously via JavaScript, waits for the landscape photograph element to be present, and asserts that its `src` DOM property resolves to a path containing the string "landscape". The test validates that the browser correctly processes asynchronously injected images and that the correct image URL is assigned.

The migration replaces the `WebDriverWait` + `ExpectedConditions.presenceOfElementLocated` pattern with Playwright's built-in auto-retrying `toHaveAttribute` assertion, removes all JUnit 5 driver-lifecycle boilerplate, extracts the page into a `PageClassLoadingImages` following qa-master §5a (every page the test visits gets a `PageClass<Name>`), and wires the page object via the base fixture.

### What bug does this catch?

Catches a regression where the landscape image on the loading-images demo page fails to appear in the DOM, or appears but receives an incorrect or empty `src` attribute — e.g., a broken JavaScript timer that never fires, a wrong image path, or a removed/renamed element ID.

### User-perceivable assertion checklist

- [ ] After navigating to the loading-images page: the landscape photograph element (`#landscape`) is present (attached) in the document within 10 seconds
- [ ] After the element appears: the landscape image's `src` attribute value contains the substring `"landscape"` (case-insensitive)

---

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 40 | KB-UNCLASSIFIED | WebDriverManager installer in test setup | `WebDriverManager.chromedriver().create()` | DROPPED — Playwright bundles browser management; entire `@BeforeEach` replaced by `page` fixture |
| H | 50–51 | KB-1.4.12 | hardcoded-url | `driver.get("https://bonigarcia.dev/selenium…")` | `baseURL` in `playwright.config.ts`; relative path in `PageClassLoadingImages.url` |
| H | 52 | KB-1.3.4 | WebDriverWait boilerplate per element | `new WebDriverWait(driver, Duration.ofSeconds(10))` | DROPPED — Playwright web-first assertions auto-poll; explicit `{ timeout: 10_000 }` preserves budget |
| H | 54–55 | KB-1.3.15 | ExpectedConditions ceremony | `wait.until(ExpectedConditions.presenceOfElement…)` | `await expect(page.locator('#landscape')).toHaveAttribute('src', /landscape/i, { timeout: 10_000 })` |
| M | 44–46 | KB-1.3.12 | manual `driver.quit()` in `@AfterEach` | `driver.quit();` | DROPPED — Playwright disposes `BrowserContext` and `Page` per test automatically |
| M | 56–57 | KB-1.3.10 | sync DOM-property assertion (no retry) | `assertThat(landscape.getDomProperty("src"))` | `await expect(page.locator('#landscape')).toHaveAttribute('src', /landscape/i)` — polls until match |

### Unclassified smells

**WebDriverManager auto-installer** (`KB-UNCLASSIFIED`, line 40): `WebDriverManager.chromedriver().create()` reaches out to a binary registry on every run to download/verify the matching ChromeDriver binary — the Java counterpart of the Python `webdriver-manager` smell. No Selenium Java–specific KB entry exists for this pattern. Playwright separates browser provisioning (`npx playwright install chromium`, run once at CI setup time) from test execution entirely. Reviewer: confirm whether this pattern should be catalogued as `KB-1.3.25` in `config/knowledge-base.md`.

---

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `By.id("landscape")` (line 55) | `page.locator('#landscape')` | high | Mechanical translation per KB hallucination rule: `By.id("x")` → `locator("#x")`. The id `landscape` does not match a testid-attribute convention (`data-testid`, `data-cy`, etc.). `page.getByAltText(/landscape/i)` would be semantically preferable if the `<img>` carries a non-empty `alt` attribute, but no DOM evidence is available from the source — see Q1. Do **not** promote to `getByRole` without aria evidence. |

---

## Hallucination-defense pins

N/A — all locators in the table above are HIGH confidence.

The single locator `By.id("landscape")` maps mechanically to `page.locator('#landscape')` (HIGH confidence) per the KB hallucination rule for `By.id`. If the reviewer answers Q1 (alt text confirmed on `<img id="landscape">`), Stage 2 should upgrade to `page.getByAltText(/landscape/i)` at that point; no pin is needed to govern the fallback because the CSS id selector is mechanically correct regardless.

---

## Structural changes

The qa-master architecture requires at least one `PageClass<Name>` per visited page (`analyze.md §5a`). Even though the source is trivial, the page is extracted to `loading-images.page.ts` so the test can use the injected fixture and the POM can be extended if the scope expands.

### 5a — Page: `outputs/helper/page-object/pages/loading-images.page.ts`

**Class:** `PageClassLoadingImages extends BasePage`

**URL:** `url = '/selenium-webdriver-java/loading-images.html'` (relative; `baseURL` from `playwright.config.ts`)

**Locator fields:**
- `readonly imageLandscape` — `this.page.locator('#landscape').describe('[LoadingImages] Landscape lazy-loaded image')`

**Methods:**
- `open(): Promise<void>` — `await this.page.goto(this.url); await this.waitForPageLoad();`
- `waitForPageLoad(): Promise<void>` — `await expect(this.imageLandscape, '[LoadingImages] Landscape image should be attached').toBeAttached({ timeout: IMAGE_LOAD_TIMEOUT_MS })` where `IMAGE_LOAD_TIMEOUT_MS = 10_000` (preserves source's 10 s `WebDriverWait` budget; see Q5)

**Label constant:** `LABEL_LOADING_IMAGES = "LoadingImages"` (imported from `@test-data/labels`).

### 5b — Blocks

None — single locator, no section reaches the 5-locator / 3-method threshold. No reuse across pages.

### 5c — Fixtures: `outputs/helper/fixtures/base.fixture.ts` (mutate)

Add `loadingImagesPage: PageClassLoadingImages` injection so the spec receives the page object without manually constructing it:

```typescript
loadingImagesPage: async ({ page }, use) => use(new PageClassLoadingImages(page)),
```

### 5d — API wrappers

None — no data preparation; the test navigates to a public demo page with no user state.

### 5e — Actions

None — single-page journey (navigate → one assertion).

### 5f — Utilities

None — `toHaveAttribute('src', /landscape/i)` handles the substring match directly; no parsing step required.

### 5g — Test-data: `outputs/helper/test-data/labels.ts` (mutate)

Add `LABEL_LOADING_IMAGES = "LoadingImages"` — used in all `.describe()` messages and `expect()` label arguments within `PageClassLoadingImages`.

Add `IMAGE_LOAD_TIMEOUT_MS = 10_000` to a constants file (either `labels.ts` or a new `timeouts.ts`; reviewer to decide placement). This preserves the source's 10-second WebDriverWait budget explicitly rather than burying it as a magic number.

### 5h — Types

None — no new API response shapes or internal value objects.

### 5i — Spec file: `outputs/tests/explicit-wait-jupiter-test.spec.ts`

- Imports `test`, `expect` from `@fixtures/base.fixture`
- One `test.describe("Loading images", { tag: ["@positive", "@e2e"] }, () => { ... })`
- One `test("[EWT-1] - Check that the landscape image loads with the correct src", ...)` using injected `loadingImagesPage`
- Two `test.step` blocks: (1) open the page, (2) assert landscape image src attribute

### Summary table

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/loading-images.page.ts` | qa-master §5a mandate; exposes `#landscape` locator + `open()` + `waitForPageLoad()` with 10 s tolerance |
| Block | (none) | Single locator — block threshold not reached |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add `loadingImagesPage: PageClassLoadingImages` fixture injection |
| API | (none) | No data preparation needed |
| Action | (none) | Single-page journey, no multi-POM flow |
| Utility | (none) | `toHaveAttribute` with regex covers the assertion; no parsing utility needed |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | Add `LABEL_LOADING_IMAGES` and `IMAGE_LOAD_TIMEOUT_MS` constants |
| Type | (none) | No new type shapes |
| Spec | `outputs/tests/explicit-wait-jupiter-test.spec.ts` | The migrated test |

---

## Open questions for reviewer

```
Q1: Does <img id="landscape"> carry a non-empty alt attribute on the loading-images page?
Context: Line 55 — By.id("landscape") translated to page.locator('#landscape') (HIGH confidence).
  If the element is <img id="landscape" alt="Landscape photograph"> or similar, the preferred
  Playwright locator is page.getByAltText(/landscape/i), which is semantically grounded and
  accessibility-friendly — and would raise the selector quality score from 0.0 to 1.0.
What I assumed: no alt attribute confirmed; proceeding with page.locator('#landscape').
Impact if wrong: test still works with CSS id selector; the locator is merely lower in the
  priority hierarchy. No functional regression, but selector quality metric stays 0/1 instead
  of 1/1.
```

```
Q2: Should waitForPageLoad() use toBeAttached() (DOM presence) or toBeVisible() (rendered)?
Context: Lines 54–55 — ExpectedConditions.presenceOfElementLocated checks DOM presence only,
  not visibility. The image could theoretically enter the DOM before it is rendered visible.
What I assumed: toBeAttached({ timeout: 10_000 }) preserves the original semantics. The
  subsequent toHaveAttribute assertion confirms the src is set. The upgrade over the original
  is intentional: toHaveAttribute also waits for the attribute, fixing the race the Selenium
  version had between presenceOfElementLocated and getDomProperty.
Impact if wrong: if the page inserts the element as display:none before revealing it,
  toHaveAttribute still passes (attribute is readable on hidden elements). If the intent is
  to assert the image is rendered (painted pixels), add a toBeVisible() assertion in the spec.
```

```
Q3: Is getDomProperty("src") semantically equivalent to getAttribute("src") for this assertion?
Context: Lines 56–57. getDomProperty("src") (Selenium 4) returns the FULLY RESOLVED absolute
  URL (e.g. https://bonigarcia.dev/selenium-webdriver-java/img/landscape.png). Playwright's
  toHaveAttribute('src', ...) reads the raw HTML attribute which may be a relative path
  (e.g. img/landscape.png). Both contain the substring "landscape" so the regex /landscape/i
  matches either form.
What I assumed: functional equivalence for this assertion — the attribute form also contains
  "landscape" in its value.
Impact if wrong: if the src attribute is set to an opaque hash path without "landscape" (and
  the browser resolves it to an absolute URL that does contain "landscape"), toHaveAttribute
  will fail where the Selenium test passed. Confirm the literal src attribute value on the page.
```

```
Q4: What baseURL should playwright.config.ts use?
Context: Lines 50–51 — driver.get("https://bonigarcia.dev/selenium-webdriver-java/loading-images.html").
  Per KB-1.4.12 and migration-rules.md §6, the base URL should come from config/env.
What I assumed: baseURL = 'https://bonigarcia.dev' (or process.env.BASE_URL), and
  PageClassLoadingImages.url = '/selenium-webdriver-java/loading-images.html'.
Impact if wrong: if relative URLs are used but baseURL is not configured, page.goto('/...')
  will resolve against localhost:3000 and fail immediately with connection-refused. Reviewer
  must confirm the BASE_URL env var is set for this SUT.
```

```
Q5: Is Playwright's default expect timeout (5 000 ms) sufficient for images to appear on CI?
Context: Line 52 — new WebDriverWait(driver, Duration.ofSeconds(10)). The plan adds
  { timeout: IMAGE_LOAD_TIMEOUT_MS } (10 000 ms) to waitForPageLoad() and recommends the same
  on the toHaveAttribute assertion in the spec.
What I assumed: the 10 s budget must be preserved to avoid introducing a flake that did not
  exist in the Selenium version (images may take 5–10 s on cold CI runners).
Impact if wrong: if 5 s is always sufficient, the named constant is harmless overhead; if 5 s
  is insufficient without the override, the migrated test will flake on slow runners while the
  Selenium version passed.
```

```
Q6: Should the test scope expand to cover the other images on the page?
Context: The page is named "loading-images" and Boni Garcia's demo page loads multiple images
  (landscape, compass, driver, timelapse). The source asserts only on #landscape.
What I assumed: migrate only the assertions present in the source — one image, one test.
Impact if wrong: the other images remain uncovered; CDN misconfiguration on non-landscape images
  would not be caught. Reviewer may want additional test() blocks or a data-driven loop across
  all four image IDs. Out of scope for this migration without explicit sign-off.
```

---

## Risk callouts

- **External SUT dependency**: the test navigates to `https://bonigarcia.dev/...` — a public internet service outside the team's control. SSL cert rotation, DNS changes, CDN outages, or the maintainer retiring the page will fail the test with no product regression signal. Recommend: (a) mock the page via `page.route` or a local fixture, (b) host a local copy of the loading-images HTML in `inputs/_fixtures/`, or (c) tag `@e2e` and gate the test out of fast-feedback CI runs while keeping it in nightly/scheduled runs.

- **Timeout mismatch (Q5)**: the source explicitly waits 10 s; Playwright's default `expect.timeout` is 5 000 ms. Without `{ timeout: IMAGE_LOAD_TIMEOUT_MS }` on `waitForPageLoad()` and the spec's `toHaveAttribute` call, the migrated test will flake on any CI runner that takes 5–10 s to load the images. Stage 2 **must** carry the explicit timeout constant forward.

- **`getDomProperty("src")` vs `getAttribute("src")` format drift (Q3)**: `getDomProperty` returns the browser-resolved absolute URL; `toHaveAttribute` reads the raw HTML attribute. The regex `/landscape/i` is safe here because "landscape" appears in both forms. If this migration pattern is reused for an attribute-value exact-match test, it will silently fail when relative and absolute paths differ.

- **`presenceOfElementLocated` semantics upgrade**: the migration upgrades the assertion from "element exists in DOM" to "element has correct `src` attribute". This is strictly stronger — if the element is in the DOM but `src` is empty or `null` (a race where the element is inserted before JavaScript sets `src`), the original Selenium test would pass while the migration catches the real failure. This is an intentional quality improvement, not a behavioural drift.

- **Narrow coverage**: only one of four lazy-loaded images is asserted. A CDN misconfiguration on the compass, driver, or timelapse images would not be caught by this test.

---

## Expected metrics

- **Selector quality score (estimated):** 0.0 (0/1 — single locator is CSS id; upgrades to 1.0/1.0 if reviewer answers Q1 and confirms `alt` attribute)
- **Smell count delta vs source:** −6 (−1 WebDriverManager unclassified, −1 hardcoded URL, −1 `WebDriverWait`, −1 `ExpectedConditions`, −1 `driver.quit()` teardown, −1 sync DOM-property assertion; 0 new smells introduced)
- **New test file LOC estimate:** ~30 (spec) + ~25 (page) + ~5 (labels/constants) = ~60 target LOC
- **LOC delta:** source ~61 → target ~60, net **~−1** (boilerplate removed; POM extraction partially offsets)
- **Anti-pattern coverage:** 6/6 cataloged rows fully addressed (plus 1 unclassified smell flagged)
