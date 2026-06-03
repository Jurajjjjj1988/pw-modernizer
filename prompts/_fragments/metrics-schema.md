Five metrics in every migration report. Stage 1 (analyze) emits estimates in the plan's `## Expected metrics` section. Stage 2 (generate) emits actuals in the report's `## Metrics` section. The verifier spot-checks all five — a demonstrably false claim is a `block`-severity finding.

- **Selector quality score** — `X/Y` where `X` = count of locators using `getByRole` + `getByLabel` + `getByPlaceholder` + `getByText` + `getByTestId`, `Y` = total locators used in the migrated test. Target ≥ **0.7**. Report as a ratio (e.g., `8/10 = 0.80`).
- **Web-first assertion rate** — `X/Y` where `X` = `await expect(locator).<matcher>()` calls, `Y` = total assertions. Target **1.0** (every assertion is web-first). Any non-web-first assertion is a smell.
- **Smell count delta vs source** — per-category counts with sign, one line each. Categories: hard waits, magic numbers, `force: true`, `nth()`/`:nth-child`, hardcoded URLs, swallowed errors (try/except pass), other (specify). Format: `Hard waits: -4`. Plus a `Forbidden patterns remaining` line — list each with `file:line` or `none`.
- **AST-diff-not-trivial** — `yes/no`. `yes` = structural changes beyond renaming (locator strategy changed, anti-patterns removed, structure refactored). `no` = mostly identifier renaming, which should NEVER be `yes` after a real plan execution. If `no`, surface loudly — the plan failed to drive real change.
- **TypeScript strict mode** — `pass/fail`. `pass` = no `any`, no `@ts-ignore`, no unsafe casts (`as unknown as`), all locators typed via Playwright generics.

Units recap: scores and rates are dimensionless ratios in `[0, 1]`. Smell counts are signed integers (negative = improvement). AST-diff and TS strict are booleans.

Canonical source: `config/migration-rules.md` §10. Generator and verifier read the SAME schema — drift between the two is reported as a metric-accuracy discrepancy by the verifier.
