# Migration report: wishlist.cy.js

## Source → Target
- Source: `inputs/cypress/wishlist.cy.js` (52 LOC)
- Output: `outputs/tests/search-filters.spec.ts` (61 LOC)
- LOC delta: +9

## Quality scores
- **Aggregate confidence:** 0.76
- Selector quality: 100% canonical (0 canonical / 0 fragile)
- Web-first assertion rate: 100%
- Plan confidence: 1 high / 5 med / 6 low → avg 0.43

### Confidence breakdown
| Signal | Value | Weight | Contribution |
|---|---|---|---|
| Plan confidence | 0.43 | 0.40 | 0.173 |
| Selector quality | 1.00 | 0.25 | 0.250 |
| Web-first rate | 1.00 | 0.10 | 0.100 |
| Smell removal rate | 0.91 | 0.15 | — |
| Forbidden absence | 1.00 | 0.10 | 0.100 |

## Smell count (source → output → delta)
| Smell | Source | Output | Delta |
|---|---|---|---|
| hardWaits | 6 | 0 | -6 |
| magicNumbers | 8 | 2 | -6 |
| forcedClicks | 0 | 0 | +0 |
| nthSelectors | 2 | 0 | -2 |
| cssClassSelectors | 6 | 0 | -6 |
| pagePauses | 0 | 0 | +0 |
| testOnly | 0 | 0 | +0 |
| testSkip | 0 | 0 | +0 |
| anyType | 0 | 0 | +0 |
| consoleLog | 0 | 0 | +0 |
| nonWebFirstAsserts | 0 | 0 | +0 |
| conditionalInTest | 0 | 0 | +0 |

## Forbidden patterns in output
✅ None.

## AST diff
- **Trivial (cosmetic-only)?** ✅ no

## Recommended human checks
1. Spot-check 2-3 LOW-confidence locator translations from the plan — do they match the real DOM?
2. Run the migrated test against staging; verify it catches the same bugs as the source did.
3. If verify report exists (`outputs/reports/wishlist.cy.js-verify.md`), read the disagreements section.
