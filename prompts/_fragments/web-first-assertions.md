All assertions must use Playwright's auto-retrying web-first matchers. The auto-retry IS the assertion — bypassing it turns the test into a synchronous probe that races the UI and produces flake.

**CORRECT** — web-first matchers on a `Locator`:
- `await expect(locator).toBeVisible()`
- `await expect(locator).toHaveText("…")` / `.toContainText("…")`
- `await expect(locator).toHaveCount(N)`
- `await expect(locator).toHaveURL(/…/)` (on `page`)
- `await expect(locator).toBeEnabled()` / `.toBeDisabled()` / `.toBeHidden()`

**REJECT** — sync probes that bypass auto-retry:
- `expect(await locator.isVisible()).toBe(true)` — snapshot at one instant, no retry.
- `expect(await locator.textContent()).toBe("…")` — same.
- `expect(await locator.count()).toBe(N)` — same.

Raw text assertions without a web-first wrapper, or asserting on a value already resolved with `await`, defeat the entire reason Playwright's `expect` exists. Target rate in migration reports: **1.0** (every assertion is web-first). Canonical source: `config/migration-rules.md` §5.
