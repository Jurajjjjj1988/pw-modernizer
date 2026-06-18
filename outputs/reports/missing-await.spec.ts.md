# Migration report: missing-await.spec.ts

## Source → Target
- Source: `inputs/bad-playwright/missing-await.spec.ts` (31 LOC)
- Output: `outputs/tests/search-filters.spec.ts` (61 LOC)
- LOC delta: +30

## Quality scores
- **Aggregate confidence:** 0.72
- Selector quality: 100% canonical (0 canonical / 0 fragile)
- Web-first assertion rate: 100%
- Plan confidence: 1 high / 0 med / 4 low → avg 0.36

### Confidence breakdown
| Signal | Value | Weight | Contribution |
|---|---|---|---|
| Plan confidence | 0.36 | 0.40 | 0.144 |
| Selector quality | 1.00 | 0.25 | 0.250 |
| Web-first rate | 1.00 | 0.10 | 0.100 |
| Smell removal rate | 0.83 | 0.15 | — |
| Forbidden absence | 1.00 | 0.10 | 0.100 |

## Smell count (source → output → delta)
| Smell | Source | Output | Delta |
|---|---|---|---|
| hardWaits | 4 | 0 | -4 |
| magicNumbers | 5 | 2 | -3 |
| forcedClicks | 0 | 0 | +0 |
| nthSelectors | 0 | 0 | +0 |
| cssClassSelectors | 1 | 0 | -1 |
| pagePauses | 1 | 0 | -1 |
| testOnly | 0 | 0 | +0 |
| testSkip | 0 | 0 | +0 |
| anyType | 0 | 0 | +0 |
| consoleLog | 0 | 0 | +0 |
| nonWebFirstAsserts | 1 | 0 | -1 |
| conditionalInTest | 0 | 0 | +0 |

## Forbidden patterns in output
✅ None.

## AST diff
- **Trivial (cosmetic-only)?** ✅ no

## Recommended human checks
1. Spot-check 2-3 LOW-confidence locator translations from the plan — do they match the real DOM?
2. Run the migrated test against staging; verify it catches the same bugs as the source did.
3. If verify report exists (`outputs/reports/missing-await.spec.ts-verify.md`), read the disagreements section.
