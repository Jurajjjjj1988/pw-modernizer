# Human-acceptance rubric

> The single binary verdict that defines "good migration". Every quality % this
> project reports is `acceptable / labeled` over migrations scored against THIS
> rubric — with a Wilson confidence interval (`scripts/lib/binom.ts`), never a
> bare point estimate. Labels live in `labels/acceptance.jsonl`; the calibration
> that joins labels to the scorer's confidence is `scripts/acceptance-calibrate.ts`.
>
> This exists because the prior ~33% number was LLM-generated, had no rubric, and
> was unreproducible (audit: `human-acceptable-label-unauditable`).

## The verdict

A migration is **ACCEPTABLE** if and only if a senior SDET would **merge it with
at most trivial edits** (rename, a comment, a single import nudge) — i.e. it is
correct and own-able as-is. Otherwise it is **NOT_ACCEPTABLE**. There is no
middle grade: "needs a real fix" is NOT_ACCEPTABLE.

A migration is **ACCEPTABLE** only when ALL hold:

1. **Behavioral parity** — it asserts the SAME observable behavior as the source
   test (every source assertion has a corresponding output assertion; none are
   dropped, inverted, or weakened; no invented assertions that the source never
   made).
2. **Real locators** — every locator is either DOM-grounded or derivable from the
   source. No invented `getByTestId`/`getByRole` the source/app never had; no
   `ask FE to add a data-testid` placeholders shipped as if real.
3. **Robust locators** — no brittle CSS-class / positional (`.nth`) / XPath
   selector survives as the primary locator (a documented fallback is fine).
4. **No POM contamination** — a shared page object's `waitForPageLoad()` gates on
   a structural invariant, not this scenario's content.
5. **Compiles & parses** — tsc clean, `playwright test --list` succeeds, pwm-blueprint
   conformance clean (no `import from '@playwright/test'` in a spec, etc.).
6. **No silent no-op** — assertion count is consistent with the source's intent
   (not floored to 1).

## Reason codes (for NOT_ACCEPTABLE)

Record one or more in `reasons[]`:

| code | meaning |
|---|---|
| `hallucinated-locator` | invented testid/role with no source/DOM evidence |
| `brittle-selector` | CSS-class / `.nth` / XPath kept as the primary locator |
| `dropped-assertion` | a source assertion is missing in the output |
| `weakened-assertion` | assertion present but laxer than source (e.g. visible vs exact text) |
| `inverted-assertion` | assertion checks the wrong condition |
| `invented-assertion` | output asserts something the source never did (e.g. name-pinned `toContainText('Jane')`) |
| `pom-contamination` | shared page gates on scenario content |
| `broken-build` | tsc / parse / conformance failure |
| `wrong-behavior` | the flow no longer exercises the same path |
| `style` | pwm-blueprint architecture violation that needs a real edit |

## How to label

For each migration, a human reviewer reads the source + the emitted tree
(spec + POMs + helpers), applies the verdict above, and appends one JSONL record
to `labels/acceptance.jsonl`:

```json
{"input_basename":"nth-selectors.spec.ts","framework":"bad-playwright","verdict":"NOT_ACCEPTABLE","reasons":["hallucinated-locator","brittle-selector"],"rater":"jk","date":"2026-06-25","notes":"product-listing.page.ts invents getByTestId('cart-count'); source used .product-card"}
```

`verdict` is one of `ACCEPTABLE` | `NOT_ACCEPTABLE` | `UNLABELED` (a placeholder
row awaiting review; ignored by the calibrator). Then run
`npm run calibrate:acceptance` to get the acceptance rate + CI and the
confidence threshold that best predicts ACCEPTABLE.

## Why binary

A binary verdict with reason codes is reproducible (two raters can agree) and
feeds a clean calibration (does `confidence >= t` predict ACCEPTABLE?). A 1–5
"quality score" is not reproducible across raters and cannot be calibrated
against the gate. The cost is nuance; the gain is a number we can defend.
