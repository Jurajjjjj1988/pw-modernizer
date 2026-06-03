# Migration plan: invite-modal.spec.ts

## Source framework
selenium-python

## Summary
Modal invite flow. This plan deliberately references Q-greeting in a
hallucination-defense pin WITHOUT a matching entry in the
"Open questions for reviewer" section. The validator must flag the
orphan Q-slug.

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet | Replacement |
|---|---|---|---|---|---|
| H | 9 | KB-1.4.1 | time-sleep-hard-wait | `time.sleep(2)` | web-first assertion |

## Hallucination-defense pins

1. **Dashboard greeting** — assumed `page.getByRole('heading', { name: /welcome/i })`.
   WHY-comment: `Q-greeting unresolved: heading role assumed`.
   Reviewer fallback: confirm heading role via DOM.

2. **Modal dialog** — assumed `page.getByRole('dialog')`.
   WHY-comment: `Q-modal unresolved: dialog role not confirmed`.
   Reviewer fallback: ask FE team to add `role="dialog"`.

## Open questions for reviewer

- Q-modal: dialog role not confirmed via DOM.

## Expected metrics

(Note: Q-greeting referenced in pins is intentionally NOT listed in
Open questions above — this is the calibration target. Validator must
reject the pin slug as orphan.)

- Selector quality score: 0.78
- Smell count delta: -1
- LOC delta: 3
