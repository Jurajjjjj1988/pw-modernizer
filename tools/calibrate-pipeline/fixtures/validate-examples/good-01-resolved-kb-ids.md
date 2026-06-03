# Migration plan: input.spec.ts

## Source framework
bad-playwright

## Summary
Acme Shop login smoke. Two scenarios: a valid credential pair lands on
`/dashboard`; an invalid pair surfaces an error banner without leaving
`/login`. Subtractive migration — no framework translation.

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet | Replacement |
|---|---|---|---|---|---|
| H | 8 | KB-1.1.1 | hard-wait | `page.waitForTimeout(2000)` | web-first assertion |
| M | 12 | KB-1.1.3 | css-class-selector | `page.locator('.dashboard-greeting')` | `getByRole('heading')` |
| L | 18 | KB-1.1.5 | sync-probe | `expect(await el.isVisible()).toBe(true)` | `await expect(el).toBeVisible()` |

## Open questions for reviewer

- Q-greeting: greeting element type unknown — assumed heading role.
- Q-error-banner: alert role not confirmed on the error banner.

## Risk callouts
None — KB-1.1.1 and KB-1.1.3 are both stable, well-understood smells.

## Expected metrics
- Selector quality score: 0.85
- Smell count delta: -3
- LOC delta: -4
