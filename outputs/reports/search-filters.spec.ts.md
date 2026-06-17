# Migration report: search-filters.spec.ts

## Source → Target
- Source: `inputs/bad-playwright/search-filters.spec.ts` (60 LOC)
- Output: `outputs/tests/search-filters.spec.ts` (61 LOC)
- LOC delta: +1

## Quality scores
- **Aggregate confidence:** 0.74
- Selector quality: 100% canonical (0 canonical / 0 fragile)
- Web-first assertion rate: 100%
- Plan confidence: 0 high / 8 med / 10 low → avg 0.38

### Confidence breakdown
| Signal | Value | Weight | Contribution |
|---|---|---|---|
| Plan confidence | 0.38 | 0.40 | 0.151 |
| Selector quality | 1.00 | 0.25 | 0.250 |
| Web-first rate | 1.00 | 0.10 | 0.100 |
| Smell removal rate | 0.94 | 0.15 | — |
| Forbidden absence | 1.00 | 0.10 | 0.100 |

## Smell count (source → output → delta)
| Smell | Source | Output | Delta |
|---|---|---|---|
| hardWaits | 8 | 0 | -8 |
| magicNumbers | 9 | 2 | -7 |
| forcedClicks | 0 | 0 | +0 |
| nthSelectors | 1 | 0 | -1 |
| cssClassSelectors | 10 | 0 | -10 |
| pagePauses | 0 | 0 | +0 |
| testOnly | 0 | 0 | +0 |
| testSkip | 0 | 0 | +0 |
| anyType | 0 | 0 | +0 |
| consoleLog | 0 | 0 | +0 |
| nonWebFirstAsserts | 4 | 0 | -4 |
| conditionalInTest | 1 | 0 | -1 |

## Forbidden patterns in output
✅ None.

## AST diff
- **Trivial (cosmetic-only)?** ✅ no

## Recommended human checks
1. Spot-check 2-3 LOW-confidence locator translations from the plan — do they match the real DOM?
2. Run the migrated test against staging; verify it catches the same bugs as the source did.
3. If verify report exists (`outputs/reports/search-filters.spec.ts-verify.md`), read the disagreements section.
