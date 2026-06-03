These never appear in committed Playwright TypeScript. The post-generate evaluator scans for them and rejects migrations that include any. Canonical source: `config/migration-rules.md` §5 + §8.

- **Hard waits** — `page.waitForTimeout(N)`, `await new Promise(r => setTimeout(r, …))`, raw `setTimeout`, `sleep`. Replace with web-first assertion on the actual condition (element visible, URL match, specific request).
- **`force: true` clicks** — bypasses actionability checks; the bug the force was added to suppress is still there. Only allowed when the plan explicitly authorized it with a documented reason.
- **`any` types** — erases the type system's value. Use `unknown` and narrow, or import Playwright's `Page`, `Locator`, `APIRequestContext`, `BrowserContext`.
- **`as unknown as X` casts** — either the types are wrong (fix them) or the cast is hiding a bug.
- **`// @ts-ignore` / `// @ts-expect-error`** without a TODO ticket reference — silences the compiler. If you must, link to a ticket.
- **`test.only` / `it.only` / `fdescribe` / `fit` / `describe.only`** — skips every other test silently. CI catches this via `forbidOnly`, but it shouldn't reach CI.
- **`console.log` / `console.debug`** — debug residue. Use the reporter.
- **Magic numbers** — extract to named constants (other than `0` and `1` in obvious contexts).
- **Hardcoded URLs** — use `baseURL` from config + relative paths.
- **Hardcoded credentials** — `.env` + `dotenv` or fixtures, never inline.
- **`try/catch` wrapping a Playwright action** — either the action is expected to throw (`await expect(action).rejects.toThrow()`) or the catch is hiding a real failure. Same applies to `try/except: pass` in source.
- **Conditional test logic** — `if (await el.isVisible()) { … }` branching means the test asserts nothing. Split into two tests.
- **Screenshots as assertions** — `page.screenshot()` with no following `expect()` is not a test.
- **`.nth(N)` / `:nth-child` / array indexing** into locator collections without a `// TODO: fragile selector — add testid` comment.
- **Locator chains that bypass auto-retry** — `(await page.locator(…).all())[2]`. Use `.nth(N)` (with comment) or refine the locator.
- **`page.pause()`** — debug-only API; never in committed code.
