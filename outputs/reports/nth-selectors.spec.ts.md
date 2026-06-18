# Migration report: nth-selectors.spec.ts

## Source → Target
- Source: `inputs/bad-playwright/nth-selectors.spec.ts` (39 LOC)
- Output: `outputs/tests/nth-selectors.spec.ts` (62 LOC)
- LOC delta: +23

## Quality scores
- **Aggregate confidence:** 0.70
- Selector quality: 100% canonical (0 canonical / 0 fragile)
- Web-first assertion rate: 100%
- Plan confidence: 0 high / 2 med / 18 low → avg 0.24

### Confidence breakdown
| Signal | Value | Weight | Contribution |
|---|---|---|---|
| Plan confidence | 0.24 | 0.40 | 0.096 |
| Selector quality | 1.00 | 0.25 | 0.250 |
| Web-first rate | 1.00 | 0.10 | 0.100 |
| Smell removal rate | 1.00 | 0.15 | — |
| Forbidden absence | 1.00 | 0.10 | 0.100 |

## Smell count (source → output → delta)
| Smell | Source | Output | Delta |
|---|---|---|---|
| hardWaits | 1 | 0 | -1 |
| magicNumbers | 3 | 0 | -3 |
| forcedClicks | 0 | 0 | +0 |
| nthSelectors | 9 | 0 | -9 |
| cssClassSelectors | 4 | 0 | -4 |
| pagePauses | 0 | 0 | +0 |
| testOnly | 1 | 0 | -1 |
| testSkip | 0 | 0 | +0 |
| anyType | 0 | 0 | +0 |
| consoleLog | 0 | 0 | +0 |
| nonWebFirstAsserts | 2 | 0 | -2 |
| conditionalInTest | 0 | 0 | +0 |

## Forbidden patterns in output
✅ None.

## AST diff
- **Trivial (cosmetic-only)?** ✅ no

## Recommended human checks
1. Spot-check 2-3 LOW-confidence locator translations from the plan — do they match the real DOM?
2. Run the migrated test against staging; verify it catches the same bugs as the source did.
3. If verify report exists (`outputs/reports/nth-selectors.spec.ts-verify.md`), read the disagreements section.
