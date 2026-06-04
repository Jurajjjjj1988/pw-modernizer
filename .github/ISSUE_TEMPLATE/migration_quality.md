---
name: Migration quality issue
about: A Stage 1 plan or Stage 2 generated test misses an anti-pattern, hallucinates a locator, or otherwise produces lower-quality output
title: '[QUALITY] '
labels: quality
---

## Code PR link

`https://github.com/Jurajjjjj1988/PWmodernizer/pull/<N>`

## Stage 1 plan link

`outputs/plans/<input-basename>.md` on `migrator/plan-...` branch

## What the migration got wrong

Be specific. Show the source line, the plan row, and the generated code line side-by-side if possible:

```
SOURCE  (inputs/.../foo.spec.ts:42):
  await page.waitForTimeout(2000);

PLAN    (outputs/plans/foo.spec.ts.md):
  | 42 | hard-wait | KB-1.1.1 | replace with web-first |

OUTPUT  (outputs/tests/foo.spec.ts:35):
  await expect(loginButton).toBeVisible();   // <-- correct fix
```

## What I expected

The canonical fix per `config/migration-rules.md` § ... / `config/knowledge-base.md` § ....

## Aggregate confidence

What did the migration report say? Plan / selector / web-first / smell-removal / forbidden-absence values?

## Hypothesis

- [ ] Plan was correct, Stage 2 deviated → file a `verify` finding
- [ ] Plan was wrong, Stage 2 followed it faithfully → file as plan-quality + add KB entry
- [ ] Both plan and code are wrong (Claude missed an anti-pattern category) → may need new KB entry + example
- [ ] The 85% accuracy ceiling — this is in the expected 15% tail (review and move on)

## Severity (impact on future migrations)

- [ ] **High** — every future migration of this input type will hit this. Block until fixed.
- [ ] **Medium** — partial regression; KB entry tightening would help.
- [ ] **Low** — one-off; reviewer can fix in the PR.
