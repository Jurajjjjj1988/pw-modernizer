# Migration report: FluentWaitJupiterTest.java

## Source → Target
- Source: `inputs/selenium-java/FluentWaitJupiterTest.java` (66 LOC)
- Output: `outputs/tests/fluent-wait-jupiter.spec.ts` (20 LOC)
- LOC delta: -46

## Quality scores
- **Aggregate confidence:** 1.00
- Selector quality: 100% canonical (0 canonical / 0 fragile)
- Web-first assertion rate: 100%
- Plan confidence: 1 high / 0 med / 0 low → avg 1.00

### Confidence breakdown
| Signal | Value | Weight | Contribution |
|---|---|---|---|
| Plan confidence | 1.00 | 0.40 | 0.400 |
| Selector quality | 1.00 | 0.25 | 0.250 |
| Web-first rate | 1.00 | 0.10 | 0.100 |
| Smell removal rate | 1.00 | 0.15 | — |
| Forbidden absence | 1.00 | 0.10 | 0.100 |

## Smell count (source → output → delta)
| Smell | Source | Output | Delta |
|---|---|---|---|
| hardWaits | 0 | 0 | +0 |
| magicNumbers | 0 | 0 | +0 |
| forcedClicks | 0 | 0 | +0 |
| nthSelectors | 0 | 0 | +0 |
| cssClassSelectors | 0 | 0 | +0 |
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
3. If verify report exists (`outputs/reports/FluentWaitJupiterTest.java-verify.md`), read the disagreements section.
