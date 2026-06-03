Selenium sources are usually DIRECTORIES, not single files (e.g., `BasePage.java` + `LoginPage.java` + `helpers/WebDriverConfig.java` + `LoginTest.java`, or the Python equivalent `base_test.py` + `pages/*.py` + `conftest.py`). Treat the directory as **one migration unit** — the plan describes the whole unit, not file-by-file.

The Selenium Page Object Model is NOT a 1:1 translation to Playwright. Composition replaces inheritance, lazy `Locator` fields replace eager `@FindBy` proxies, web-first matchers replace `WebDriverWait`/`ExpectedConditions`, the `page` fixture replaces `ThreadLocal<WebDriver>`.

Per-file fate — record each source file as **KEPT** (reshaped), **DROPPED** (folded into a Playwright built-in), or **MERGED** (combined with another file). Reviewer needs to see why three files become two (or one).

- **`BasePage` / `BaseTest`** (parent class with `driver`, `wait`, shared helpers) — typically **DROPPED**. `WebDriverWait` / `ExpectedConditions` helpers map to Playwright web-first matchers (`await expect(...).toBeVisible()` / `.toBeHidden()`); `try-catch-as-flow` helpers (`isVisibleSafe()`) map to the same matchers. KEEP only if helpers carry domain logic.
- **`WebDriverConfig` / `DriverFactory` / `ThreadLocal<WebDriver>` / pytest `driver` fixture** — **DROPPED**. Playwright's `page` fixture + worker config replace it entirely. No target file.
- **`LoginPage extends BasePage` with `@FindBy` annotations** — **KEPT and RESHAPED** into a slim standalone Playwright POM at `outputs/tests/pages/login.page.ts`. `readonly` `Locator` fields, role-based locators, composition over inheritance. No base class.
- **`LoginTest` (`@Test` methods)** — **KEPT and RESHAPED**. `@Test` methods become `test(...)` calls inside one `test.describe(...)` in a single spec file. JUnit `@BeforeEach` / `@AfterEach` → `test.beforeEach` / `test.afterEach` (or fold into the `page` fixture). TestNG `@BeforeClass` / `@AfterClass` → worker-scoped fixtures.

Stage 1 emits the per-file fate in the plan's `## Structural changes` section. Stage 2's "Files produced" list reflects the FINAL target tree, not a 1:1 echo of the input directory — do not produce target files for DROPPED sources.
