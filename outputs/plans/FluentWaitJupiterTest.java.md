# Migration plan: FluentWaitJupiterTest.java

## Source framework

selenium-java

Source: single file `inputs/selenium-java/FluentWaitJupiterTest.java` (65 LOC). JUnit Jupiter 5
(`@Test`, `@BeforeEach`, `@AfterEach`) + Selenium WebDriver Java via `io.github.bonigarcia.wdm.WebDriverManager`
for browser provisioning. `FluentWait` + `ExpectedConditions` for explicit async waits. AssertJ
(`assertThat`) for the assertion. One test method: `testFluentWait`. No Page Object Model in the
source — all locate/wait/assert logic is inline in the test body.

Target: Playwright TypeScript (latest stable, v1.45+), qa-master v0.2.0 layered architecture.

---

## Summary

The test navigates to Boni Garcia's public `loading-images.html` demo page, which renders four
images asynchronously. It uses a `FluentWait` to poll until the element `id="landscape"` appears
in the DOM, then asserts that the element's resolved `src` property contains the substring
`"landscape"` (case-insensitive). The migration replaces the entire `FluentWait` +
`ExpectedConditions` ceremony with Playwright's built-in auto-retry, upgrades the one-shot
`assertThat(getDomProperty("src"))` to a web-first `toHaveAttribute` matcher, removes the manual
`WebDriver` lifecycle (WebDriverManager setup + `driver.quit()`), and moves the hardcoded URL
into `playwright.config.ts`. A `PageClassLoadingImages` page object is introduced per the
qa-master v0.2.0 requirement that every page visited gets a typed POM — even on trivial
single-test migrations.

### What bug does this catch?

Catches a regression where the lazy-loaded landscape image on the loading-images demo page fails
to appear in the DOM — or appears with a `src` value that no longer references a landscape
resource — within the configured wait window.

### User-perceivable assertion checklist

- [ ] After navigating to `/selenium-webdriver-java/loading-images.html`: the `#landscape` image
  element becomes present and visible (the page's progressive image load succeeds)
- [ ] After image load: the `#landscape` element's `src` attribute value contains the substring
  `"landscape"` (case-insensitive)

---

## Anti-patterns detected

Severity codes: **H** = test will flake / break / leak secrets; **M** = fragile or unreadable;
**L** = stylistic.

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 42 | KB-1.4.20\* | webdriver-manager-setup | `WebDriverManager.chromedriver().create()` | Drop entirely; Playwright `page` fixture provisions browser via `npx playwright install` — no network call in test runner |
| H | 47 | KB-1.3.12 | manual-driver-quit | `@AfterEach … { driver.quit(); }` | Drop; Playwright `page` fixture auto-disposes the browser context per test |
| H | 53 | KB-1.4.12\* | hardcoded-url | `driver.get("https://bonigarcia.dev/…")` | `baseURL` in `playwright.config.ts`; relative `page.goto('/…/loading-images.html')` in `PageClassLoadingImages.open()` |
| H | 54–57 | KB-1.3.4 | WebDriverWait-boilerplate | `new FluentWait<>(driver).withTimeout(…)` | Drop; Playwright auto-waits on assertions; `waitForPageLoad()` replaces this with `expect(imageLandscape).toBeVisible({ timeout: 10_000 })` |
| H | 59–60 | KB-1.3.15 | expected-conditions-ceremony | `wait.until(EC.presenceOfElementLocated(…))` | Drop; `page.locator('#landscape')` + Playwright auto-wait inside `waitForPageLoad()` replaces the entire EC chain |
| M | 61–62 | KB-1.3.10 | non-web-first-assertion | `assertThat(landscape.getDomProperty("src"))…` | `await expect(imageLandscape, '[…]').toHaveAttribute('src', /landscape/i)` — web-first, polled |
| L | 55–56 | KB-1.1.9 | magic-numbers (timeout/polling) | `.withTimeout(ofSeconds(10)).pollingEvery(…)` | Remove; set per-assertion `{ timeout: 10_000 }` in `waitForPageLoad()` with documented justification |

\*KB-1.4.20 (Python analog: `webdriver-manager` auto-installer) and KB-1.4.12 (Python analog:
`driver.get(url)` hardcoded URL) are cited here because the Java equivalents share the identical
bug class. No Java-specific KB entry covers these exact patterns; see Unclassified smells.

### Unclassified smells

**Line 42 — `WebDriverManager.chromedriver().create()` (Java browser auto-provisioner):**
Equivalent of Python's `webdriver-manager` (KB-1.4.20): downloads a matching ChromeDriver binary
from an external CDN on every run. Network blip → cryptic `WebDriverException: Can't open
browser` unrelated to the SUT. Playwright bundles its own browser management
(`npx playwright install chromium`) — no network call in the runner, no installer code in setup.
Reviewer: if the source suite was version-pinning Chrome for rendering consistency, the Playwright
equivalent is `channel: 'chrome'` in `playwright.config.ts`.

---

## Locator translation table

No DOM snapshot found at `outputs/dom-snapshots/FluentWaitJupiterTest.java.yaml` — proceeding
without snapshot grounding (offline mode; `validate-plan-dom-grounding.ts` exits 0 when snapshot
is absent).

| Original | New | Confidence | Notes |
|---|---|---|---|
| `By.id("landscape")` | `page.locator('#landscape')` | high | Mechanical `By.id` → CSS-id translation per mandatory hallucination-defense rule (rule 1 in analyze.md: "If source has `By.id("x")` → target is `page.locator("#x")` with HIGH confidence"). No DOM snapshot available; no confirmed alt text or aria evidence to justify a higher-priority locator. **Reviewer upgrade path (Q1):** if the rendered `<img>` has `alt="landscape"` or similar confirmed alt text, Stage 2 should use `page.getByAltText(/landscape/i)` instead — that is preferred in the Playwright locator hierarchy (§5 rule 3) and raises selector quality from 0/1 to 1/1. Without Q1 confirmation, `page.locator('#landscape')` is the correct HIGH-confidence fallback and Stage 2 must emit it. |

---

## Hallucination-defense pins

N/A — all locators are HIGH confidence. The single source locator (`By.id("landscape")` →
`page.locator('#landscape')`) is a mechanical `By.id` translation per the mandatory
hallucination-defense rule. No DOM assumption is required, therefore no pin is needed.

---

## Structural changes

**Per-file fate (single-file input):**

| Source construct | Fate | Target |
|---|---|---|
| `FluentWaitJupiterTest.java` (test class + `@Test testFluentWait`) | **KEPT + RESHAPED** | `outputs/tests/fluent-wait-jupiter.spec.ts` (1 scenario) |
| `@BeforeEach setup()` with `WebDriverManager.chromedriver().create()` | **DROPPED** | Replaced by Playwright `page` fixture (framework-provisioned) |
| `@AfterEach teardown()` with `driver.quit()` | **DROPPED** | Playwright auto-teardown; no target counterpart |
| `Wait<WebDriver>` / `FluentWait` / `ExpectedConditions.presenceOfElementLocated` | **DROPPED** | Replaced by `waitForPageLoad()` web-first assertion on `imageLandscape` |

No `BasePage`, `WebDriverConfig`, or POM file exists in the source input. The qa-master v0.2.0
architecture requires a page object even for single-page, single-test migrations
(`migration-rules.md §1`: "even trivial single-test migrations land in outputs/tests/ … with an
injected page object"). The `PageClassLoadingImages` introduced below is the minimum required POM.

**Files Stage 2 must emit:**

| Layer | File path | Why it exists |
|---|---|---|
| Page | `outputs/helper/page-object/pages/loading-images.page.ts` | Encapsulates `imageLandscape` locator, `open()`, and `waitForPageLoad()`; replaces inline locate/FluentWait in the test body; mandatory per qa-master §1 |
| Block | (none) | Single element in scope; threshold of 5+ locators not reached |
| Fixture | `outputs/helper/fixtures/base.fixture.ts` (mutate) | Add `loadingImagesPage: PageClassLoadingImages` injectable fixture; spec imports `test`/`expect` from here — never from `@playwright/test` (CLAUDE.md hard rule) |
| API | (none) | No data preparation; test reads page state only |
| Action | (none) | Single-page journey — no cross-page composition |
| Utility | (none) | No data parsing; `toHaveAttribute` + `/landscape/i` regex handles the case-insensitive substring check inline |
| Test-data | `outputs/helper/test-data/labels.ts` (mutate) | Add `export const LABEL_LOADING_IMAGES = "Loading Images"` |
| Type | (none) | No custom types needed |
| Spec | `outputs/tests/fluent-wait-jupiter.spec.ts` | The migrated test (one scenario: 1.1) |

**`PageClassLoadingImages` structural detail:**

- Class: `PageClassLoadingImages extends BasePage` (no constructor on subclass; `this.page` wired
  by `BasePage` at `@page-object/basepage`)
- `readonly url = "/selenium-webdriver-java/loading-images.html"` (relative to `baseURL`)
- Locators:
  - `imageLandscape` — `this.page.locator('#landscape').describe('[Loading Images] Landscape image')`
- Methods:
  - `open(): Promise<void>` — `await this.page.goto(this.url)` then `await this.waitForPageLoad()`
  - `waitForPageLoad(): Promise<void>` — `await expect(this.imageLandscape, '[Loading Images] Landscape image should be visible').toBeVisible({ timeout: 10_000 })`
    - Timeout of 10 s is justified: the source `FluentWait` used the same ceiling; reviewer may
      reduce to project default (5 s) if CI confirms images load faster (see Q2)

**Spec import and fixture wiring (CRITICAL — must not deviate):**

```
import { test, expect } from "@fixtures/base.fixture";   // ONLY valid import source for specs
import { LABEL_LOADING_IMAGES } from "@test-data/labels";
```

The spec receives `loadingImagesPage` as an injected fixture parameter — it NEVER calls
`new PageClassLoadingImages(page)` inline. The `@playwright/test` import is categorically
forbidden in specs (CLAUDE.md + `migration-rules.md §2`).

**Spec title and tags:**

```
test.describe("Loading images", () => {
  test("[FWJ-1] - Check that the landscape image loads with a valid src", {
    tag: ["@positive", "@e2e"],
  }, async ({ loadingImagesPage }) => { … })
})
```

`[FWJ-1]` is a placeholder ticket ID — reviewer must replace with the real tracking ID before
merge. `@e2e` is applied because the test relies on a live external SUT (see Risk callouts).

**Assertion in spec (preserving source oracle exactly):**

```
await expect(loadingImagesPage.imageLandscape,
  `[${LABEL_LOADING_IMAGES}] Landscape image src should contain "landscape"`)
  .toHaveAttribute('src', /landscape/i);
```

The regex `/landscape/i` is the direct equivalent of `containsIgnoringCase("landscape")`.
`toHaveAttribute` polls with auto-retry — web-first. See Q3 for the `getDomProperty` vs
`getAttribute` semantic gap.

---

## Open questions for reviewer

```
Q1: Does the #landscape image have a confirmed alt attribute in the rendered HTML?
Context: By.id("landscape") at source lines 59–60. No DOM snapshot available; alt text cannot be
  determined offline.
What I assumed: No accessible name confirmed → keeping page.locator('#landscape') at HIGH
  confidence (mandatory fallback per hallucination-defense rules). If alt text is confirmed, Stage 2
  should use page.getByAltText(/landscape/i) instead.
Impact if wrong: Using page.locator('#landscape') when an alt attribute exists is not incorrect
  but misses the preferred locator tier. Conversely, if Stage 2 were to emit getByAltText without
  Q1 confirmation, it could throw immediately if alt is absent.
```

```
Q2: Is the 10-second image-load timeout appropriate for CI environments?
Context: Source lines 54–55: FluentWait.withTimeout(Duration.ofSeconds(10)).pollingEvery(1s).
  Playwright default actionTimeout = 5 000 ms; plan proposes { timeout: 10_000 } in waitForPageLoad().
What I assumed: 10 s matches the source ceiling and is the safe starting point.
Impact if wrong: If images reliably load in < 5 s, the override is unnecessary noise and can be
  dropped. If CI runners are slower than 10 s (network throttling, cold start), the test still
  fails on infrastructure lag rather than a product bug — consider reading from an env var
  (process.env.IMAGE_LOAD_TIMEOUT_MS) or bumping to 15 s.
```

```
Q3: Does getDomProperty("src") vs getAttribute("src") affect the assertion correctness here?
Context: Lines 61–62: getDomProperty("src") returns the browser-resolved absolute URL; Playwright's
  toHaveAttribute('src', …) reads the raw HTML attribute (possibly a relative path, e.g.,
  "img/landscape-3297.jpg").
What I assumed: The raw src HTML attribute contains "landscape" in the filename component, so
  /landscape/i matches correctly regardless of whether the value is relative or absolute.
Impact if wrong: If the raw src is a CDN token URL without "landscape" in the path (e.g.,
  "cdn.example.com/abc123.jpg"), toHaveAttribute would pass where getDomProperty would have failed
  (or vice versa). Reviewer should spot-check the page source to confirm the raw attribute value.
```

```
Q4: Should the assertion verify that the image rendered successfully (naturalWidth > 0) rather than
  just that src was assigned?
Context: Lines 61–62: source checks src content, not whether the browser decoded the image.
  A 404 resource with "landscape" in the path would pass the current assertion.
What I assumed: Preserve the same assertion depth as the source (src contains "landscape").
  This is an inherited oracle weakness from the source, not something Stage 2 should silently fix.
Impact if wrong: If the test's intent is to verify the image was fully decoded, a follow-up
  assertion using page.evaluate() on img.complete && img.naturalWidth > 0 would be needed.
  This is a separate concern and should be a reviewed scope extension, not part of this migration.
```

```
Q5: Is the target SUT the public https://bonigarcia.dev host or an internal/staging clone?
Context: Source line 53: fully qualified absolute URL including the external hostname.
What I assumed: baseURL = "https://bonigarcia.dev" in playwright.config.ts; page.goto() uses
  the relative path "/selenium-webdriver-java/loading-images.html".
Impact if wrong: If the test is being migrated to run against a local or staging app, the URL
  path structure and element id (#landscape) may differ entirely. The locator table would need
  revisiting against the actual target DOM.
```

```
Q6: Was EC.presenceOfElementLocated (DOM presence) intentional vs visibilityOfElementLocated
  (user-visible)?
Context: Lines 59–60: the source waited for DOM presence, not CSS visibility.
What I assumed: Playwright's toBeVisible() is the stricter and more correct target (waits for the
  element to be both present AND visible), and this aligns better with user-perceivable behavior.
  waitForPageLoad() uses toBeVisible() — this is a deliberate upgrade from the source's weaker
  presenceOfElementLocated.
Impact if wrong: If the image can legitimately be in the DOM but hidden (display:none during
  progressive load), toBeVisible() would wait longer than the source did. In that case, replace
  toBeVisible() with toBeAttached() + a separate toHaveAttribute assertion.
```

---

## Risk callouts

- **External SUT dependency**: The test targets `https://bonigarcia.dev/…` — a publicly hosted
  demo site. Network instability or site downtime produces CI failures that look like test
  regressions but are infrastructure events. Apply `@e2e` tag and, if possible, exclude from
  PR-blocking gates when running against an external host.

- **Timeout mismatch on slow CI**: Source `FluentWait` used 10 s; Playwright default `actionTimeout`
  is 5 s. The plan bumps `waitForPageLoad()` to `{ timeout: 10_000 }`. On heavily throttled CI
  runners, even 10 s may be insufficient. Monitor first CI run (see Q2).

- **getDomProperty vs getAttribute semantic gap**: `getDomProperty("src")` returns the
  browser-resolved absolute URL; `toHaveAttribute` reads the raw HTML attribute (possibly relative).
  For this SUT, both should contain `"landscape"` — but the gap exists and could surface if the
  page is redesigned to serve images from a CDN with opaque path tokens (see Q3).

- **Oracle weakness — no image-rendered check**: The test verifies only that `src` contains
  `"landscape"`, not that the browser successfully decoded and displayed the image. A 404 resource
  with the right filename would pass. This weakness is inherited from the source; see Q4.

- **`@BeforeEach`/`@AfterEach` isolation is preserved**: Source created a new driver per test and
  quit after; Playwright's `page` fixture provides an equivalent fresh `BrowserContext` per test
  automatically. No additional isolation code is required, and adding `context.clearCookies()` or
  similar would be redundant noise (CLAUDE.md: KB-1.1.21).

- **Single-image coverage**: The same demo page likely contains other images (`#comic`, `#nature`,
  `#city`). The migration preserves exactly the source's scope (only `#landscape`). Extending
  coverage is a separate PR.

---

## Expected metrics

- **Selector quality score (estimated):** 0/1 = **0.0** (pre-reviewer-action on Q1). The single
  locator `page.locator('#landscape')` is a CSS-id selector, not role/label/altText-based. If the
  reviewer confirms alt text (Q1) and Stage 2 upgrades to `page.getByAltText(/landscape/i)`, score
  becomes 1/1 = 1.0. Target ≥ 0.7 is achievable only with reviewer action on Q1.

- **Smell count delta vs source:** −7 (−1 WebDriverManager setup, −1 `driver.quit()`, −1 hardcoded
  URL, −1 FluentWait boilerplate, −1 ExpectedConditions ceremony, −1 sync DOM-property assertion,
  −1 magic timeout/polling numbers). Zero new smells introduced.

- **LOC delta (estimated):** Source 65 LOC → ~25 spec LOC + ~22 page LOC = ~47 target LOC → **delta
  ≈ −18**. Net reduction despite adding a POM file, because the Java `FluentWait` +
  `ExpectedConditions` + class/import boilerplate collapses into ~3 declarative TypeScript lines.

- **Anti-pattern coverage:** 7/7 catalogued (6 KB-ID citations + 1 using cross-framework analogs)
  + 1 unclassified (WebDriverManager Java provisioner).
