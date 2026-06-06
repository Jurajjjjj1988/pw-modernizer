# Migration plan: FluentWaitJupiterTest.java

## Source framework

**Selenium Java** — JUnit 5 (Jupiter) test runner, `io.github.bonigarcia.wdm.WebDriverManager` for
browser provisioning, `org.openqa.selenium.support.ui.FluentWait` + `ExpectedConditions` for explicit
waits, AssertJ (`assertThat`) for assertions, Selenium WebDriver 4.x API implied by `Duration`-based
timeout overloads. Single-file input (no sibling POM or helper classes).

## Summary

The test navigates to Boni Garcia's public `loading-images.html` demo page, which renders four images
asynchronously. It uses a `FluentWait` to poll until the element `id="landscape"` appears in the DOM,
then asserts that the element's resolved `src` property contains the substring "landscape"
(case-insensitive). The migration replaces the entire FluentWait/ExpectedConditions ceremony with
Playwright's built-in auto-retry, collapses the two-step wait+assert into a single web-first
`toHaveAttribute` call, and moves the hardcoded URL into `playwright.config.ts`.

### What bug does this catch?

Catches a regression where the landscape image on the loading-images page fails to materialise in the
DOM (or receives a `src` that no longer references a landscape resource) within the configured timeout.

### User-perceivable assertion checklist

- [ ] After page load: element `#landscape` is present in the DOM (was waiting for
  `EC.presenceOfElementLocated`)
- [ ] After page load: that element's `src` attribute contains the substring `"landscape"`
  (case-insensitive)

---

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 41 | KB-1.4.20 | Browser installer executed in test setup | `WebDriverManager.chromedriver().create()` | Drop entirely; Playwright bundles browsers via `npx playwright install` — no installer code in tests |
| H | 52–53 | KB-1.4.12 | Hardcoded environment URL | `driver.get("https://bonigarcia.dev/…")` | Move base origin to `playwright.config.ts` `baseURL`; use relative path in `page.goto()` |
| H | 54–57 | KB-1.3.4 | WebDriverWait/FluentWait boilerplate per element | `new FluentWait<>(driver).withTimeout(…)` | Drop; Playwright actions and `expect()` auto-wait for actionability/visibility |
| H | 59–60 | KB-1.3.15 | `ExpectedConditions` ceremony wrapping every wait | `wait.until(EC.presenceOfElementLocated(…))` | `await expect(locator).toBeAttached()` or fold into `toHaveAttribute` auto-wait |
| M | 46 | KB-1.3.12 | Manual `driver.quit()` in `@AfterEach` teardown | `driver.quit()` | Drop; Playwright tears down the `page` fixture per test automatically |
| M | 61–62 | KB-1.3.10 | Synchronous one-shot DOM-property assertion | `assertThat(landscape.getDomProperty("src"))` | `await expect(locator).toHaveAttribute('src', /landscape/i)` — auto-retrying, polled |
| L | 55–56 | KB-1.1.9 | Magic numbers (timeout and polling interval) | `.withTimeout(Duration.ofSeconds(10))` | Remove; set `expect: { timeout: 10_000 }` in `playwright.config.ts` if the default 5 s is too tight |

### Notes on KB cross-framework citations

- **KB-1.4.20** is catalogued under Selenium Python (`webdriver_manager`); used here as the exact
  Java analog (`WebDriverManager.chromedriver().create()`). The rationale is identical: network
  call on every test run = flake source unrelated to the SUT.
- **KB-1.4.12** is catalogued under Selenium Python (`driver.get(url)` hardcoded); used here for
  the Java `driver.get(url)` call. Identical bug class.
- **KB-1.3.10** is catalogued under Java (`assertTrue(driver.getCurrentUrl().contains(…))`);
  applied here to element-property assertion (`getDomProperty("src")`) — same bug class: one-shot
  snapshot, no auto-retry.

---

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `By.id("landscape")` (line 59–60) | `page.getByAltText(/landscape/i)` | med | Element id and page context (loading-images educational demo, bonigarcia) strongly suggest `<img alt="landscape">`. Educational demos from this author consistently use descriptive alt text matching the resource name. Fallback: `page.locator('#landscape')` (HIGH confidence mechanical translation per KB hallucination rule 1: `By.id("x")` → `page.locator("#x")`) if alt text does not match. |

---

## Hallucination-defense pins

1. **landscape image element** — assumed `page.getByAltText(/landscape/i)`. If DOM contradicts
   (alt text is absent or differs from "landscape"): keep `page.locator('#landscape')`, add
   WHY-comment `'Q3 unresolved — alt text not confirmed'`. Reviewer fallback: inspect
   `https://bonigarcia.dev/selenium-webdriver-java/loading-images.html` source; if `<img>` has
   `alt="landscape"` confirm and use `getByAltText`; if alt is missing or different, use
   `locator('#landscape')` with an inline comment explaining why nothing higher in the hierarchy
   works (migration-rules §5).

---

## Structural changes

### Per-file fate (selenium-multifile-rules)

Single-file input — no directory structure.

| Source construct | Fate | Target |
|---|---|---|
| `FluentWaitJupiterTest.java` (test class) | **KEPT and RESHAPED** | `outputs/tests/fluent-wait-jupiter.spec.ts` |
| `@BeforeEach setup()` with `WebDriverManager` | **DROPPED** | Replaced by Playwright `page` fixture (auto-provisioned) |
| `@AfterEach teardown()` with `driver.quit()` | **DROPPED** | Playwright auto-teardown; no target |
| `Wait<WebDriver>` / `FluentWait` / `ExpectedConditions` | **DROPPED** | Playwright auto-wait via `expect()` matchers |

### Structural decisions

- **Extract POM:** no — single test, single locator, well under the 200-LOC threshold
  (migration-rules §1 "When to add a new POM"). Inlining is the correct default.
- **Extract fixture:** no — setup is trivial (`page.goto(relative-path)`); no auth, no network
  mocking, no seeding. One `page.goto()` in `beforeEach` is within the ≤3-line rule
  (migration-rules §2 "`test.beforeEach` discipline").
- **Split file:** no — single test case.
- **Output filename:** `fluent-wait-jupiter.spec.ts` — kebab-case from `FluentWaitJupiterTest`
  per migration-rules §1 "File naming".
- **Import style:** `import { test, expect } from "@playwright/test"` (no POM extraction, ≤2
  tests, relaxed-2026 import policy per migration-rules §2).

---

## Open questions for reviewer

```
Q1: Should baseURL be set to "https://bonigarcia.dev" in playwright.config.ts?
Context: Line 52 — driver.get("https://bonigarcia.dev/selenium-webdriver-java/loading-images.html").
What I assumed (if proceeding without an answer): Yes — configure
  baseURL: process.env.BASE_URL ?? "https://bonigarcia.dev"
  and use relative path "/selenium-webdriver-java/loading-images.html".
Impact if my assumption is wrong: If this SUT is expected to be replaced by a local/staging
  clone, the relative path is wrong and the URL must be reviewed per deployment topology.
```

```
Q2: Is the 10-second wait tolerance still required, or is the default 5-second actionTimeout
    (playwright.config.ts) sufficient for this page?
Context: Lines 55–56 — .withTimeout(Duration.ofSeconds(10)).pollingEvery(Duration.ofSeconds(1)).
  The source used 10 s because WebDriverWait/FluentWait are not integrated into assertion retry;
  Playwright's web-first assertions auto-poll with the configured expect.timeout.
What I assumed (if proceeding without an answer): Raise expect.timeout to 10_000 only for this
  assertion (per-call override) to preserve original tolerance:
    await expect(locator).toHaveAttribute('src', /landscape/i, { timeout: 10_000 })
Impact if my assumption is wrong: If the demo page reliably loads within 5 s, the override is
  unnecessary noise. If CI runners are slower than 5 s, the default will fail flakily.
```

```
Q3: Does the #landscape element have alt text containing "landscape"?
Context: Line 59 — By.id("landscape") on an image-loading demo page. Almost certainly an <img>
  but the alt attribute is unknown without DOM inspection.
What I assumed (if proceeding without an answer): alt="landscape" (or similar) is present, based
  on the bonigarcia educational style and the id name. Primary recommendation is
  page.getByAltText(/landscape/i) (MED confidence). Fallback is page.locator('#landscape') (HIGH).
Impact if my assumption is wrong: If alt is absent or differs, getByAltText throws immediately.
  Switch to locator('#landscape') and add an inline WHY-comment per migration-rules §5.
```

```
Q4: Does getDomProperty("src") return an absolute URL or can the raw src attribute be a relative
    path that still contains "landscape"?
Context: Lines 61–62 — assertThat(landscape.getDomProperty("src")).containsIgnoringCase("landscape").
  getDomProperty returns the IDL attribute (resolved absolute URL), while getAttribute returns the
  raw HTML attribute (may be relative).
What I assumed (if proceeding without an answer): The raw src HTML attribute contains "landscape"
  in the filename component (e.g., "img/landscape-3297.jpg"), so toHaveAttribute('src', /landscape/i)
  matches whether the src is absolute or relative.
Impact if my assumption is wrong: If the raw src is a generic CDN URL without "landscape" in the
  path (e.g., "img/photo-3297.jpg"), toHaveAttribute would fail but getDomProperty("src") would
  still match because the resolved absolute URL contains the hostname. In that case the assertion
  must change to: await expect(locator).toHaveAttribute('src', /.+/) combined with a separate
  page.evaluate() check on the resolved src — or the assertion intent needs to be re-evaluated.
```

```
Q5: Should the assertion verify that the image RENDERED successfully (naturalWidth > 0) rather
    than just that src was assigned?
Context: Lines 61–62 — source test checks src attribute content, not whether the browser decoded
  the image. A broken link with "landscape" in the path would pass.
What I assumed (if proceeding without an answer): Preserve the same assertion depth as the source
  (src attribute contains "landscape"). Noted as a known oracle weakness.
Impact if my assumption is wrong: A stricter assertion (e.g., page.evaluate on img.complete &&
  img.naturalWidth > 0) would catch 404 image links. The reviewer may want to add this as a
  separate assertion or upgrade the locator to include a visual check.
```

```
Q6: Is there a reason the source test uses presenceOfElementLocated (DOM presence) rather than
    visibilityOfElementLocated (visible to user)?
Context: Lines 59–60 — EC.presenceOfElementLocated(By.id("landscape")). An image could be present
  in the DOM but hidden (display:none or opacity:0).
What I assumed (if proceeding without an answer): The page's intent is for images to become visible
  once loaded. If visibility is the correct contract, replace toHaveAttribute with toBeVisible()
  before the attribute assertion. Recommend reviewer confirms from the demo page behavior.
Impact if my assumption is wrong: Using only toHaveAttribute means the test passes even if the
  image is in the DOM but hidden. A two-step approach (toBeVisible then toHaveAttribute) would
  be more representative of user-perceivable behavior.
```

---

## Risk callouts

- **External SUT dependency:** The target URL is `https://bonigarcia.dev/...` — a public third-party
  site. Any downtime or rate-limiting on that domain causes flakes unrelated to product code. Consider
  whether the test should run against a local fixture server or be gated to a `@slow @e2e` tag that
  is not in the default CI matrix.

- **No image-rendered assertion:** The test verifies only that `src` contains "landscape", not that
  the browser successfully decoded and displayed the image. A 404 resource with the right filename
  passes. This is a known oracle weakness inherited from the source; see Q5.

- **`toHaveAttribute` vs `getDomProperty` semantic difference:** Selenium's `getDomProperty("src")`
  resolves the absolute URL; Playwright's `toHaveAttribute` reads the raw HTML attribute value
  (which may be a relative path). If a future change to the demo page uses a CDN URL without
  "landscape" in the path, the assertion may diverge from the original. See Q4.

- **Timeout regression:** The original FluentWait used a 10-second ceiling. Playwright's default
  `expect.timeout` is 5 seconds (migration-rules §6 config). If the image takes 6–9 seconds on a
  slow CI runner, the migrated test will fail where the original passed. Mitigation: per-assertion
  `{ timeout: 10_000 }` override; see Q2.

- **Locator confidence gap:** The primary recommended locator `page.getByAltText(/landscape/i)` is
  MED confidence. If the alt text assumption is wrong, Stage 2 emits a locator that throws
  immediately (no element found). The fallback `page.locator('#landscape')` is HIGH confidence
  and should be used if Q3 is not resolved before Stage 2 runs.

---

## Expected metrics

- **Selector quality score (estimated):** 1/1 = 1.0 if `getByAltText` confirmed; 0/1 = 0.0 if
  falling back to `locator('#landscape')`. Target ≥ 0.7 — reviewer should resolve Q3 before
  Stage 2 to achieve the target.
- **Smell count delta vs source:** −7 (−1 installer ceremony, −1 hardcoded URL, −1 FluentWait
  boilerplate, −1 ExpectedConditions ceremony, −1 manual teardown, −1 sync DOM assertion, −1 magic
  timeout/poll numbers; +0 new smells)
- **LOC delta (estimated):** −50 (source ~65 LOC Java → target ~15 LOC TypeScript; reduction from
  dropping imports, class/field boilerplate, FluentWait ceremony, @BeforeEach/@AfterEach lifecycle)
- **Anti-pattern coverage:** 7/7 catalogued, all addressed
