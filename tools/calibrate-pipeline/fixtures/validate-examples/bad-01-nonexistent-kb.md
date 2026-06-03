# Migration plan: input.spec.ts

## Source framework
bad-playwright

## Summary
Smoke flow with a citation to a phantom KB entry. The validator must
flag the dangling KB-1.99.99 reference (no such entry exists in
config/knowledge-base.md).

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet | Replacement |
|---|---|---|---|---|---|
| H | 8 | KB-1.1.1 | hard-wait | `page.waitForTimeout(2000)` | web-first assertion |
| H | 14 | KB-1.99.99 | phantom-smell | `something()` | something else |
| M | 18 | KB-1.1.5 | sync-probe | `expect(await el.isVisible()).toBe(true)` | `await expect(el).toBeVisible()` |

## Open questions for reviewer

- Q-greeting: greeting heading role assumed.

## Risk callouts

KB-1.99.99 does NOT exist. The validator must reject this plan with a
`KB ID '1.99.99' referenced but not defined` violation.

## Expected metrics
- Selector quality score: 0.85
- Smell count delta: -3
- LOC delta: -4
