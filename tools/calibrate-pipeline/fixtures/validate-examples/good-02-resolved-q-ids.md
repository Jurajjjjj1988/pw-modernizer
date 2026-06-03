# Migration plan: invite-modal.spec.ts

## Source framework
selenium-python

## Summary
Modal invite flow: open modal, fill email, send invite, confirm closed.

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet | Replacement |
|---|---|---|---|---|---|
| H | 12 | KB-1.4.1 | time-sleep-hard-wait | `time.sleep(2)` | `await expect(...).toBeVisible()` |
| M | 18 | KB-1.4.10 | selector-concat | `f"{base}#row-{i}"` | data-testid + `getByTestId` |

## Hallucination-defense pins

1. **Invite modal (dialog root)** — assumed `page.getByRole('dialog', { name: 'Invite a new user' })`.
   WHY-comment: `Q-dialog unresolved: dialog role and accessible name`.
   Reviewer fallback: ask FE team to add `role="dialog"`.

2. **Modal close button** — assumed `modal.getByRole('button', { name: 'Close' })`.
   WHY-comment: `Q-close unresolved: 3rd modal button identity`.
   Reviewer fallback: confirm aria-label.

## Open questions for reviewer

- Q-dialog: dialog role and accessible name not confirmed via DOM.
- Q-close: 3rd modal button identity unknown — best guess is the X icon.

## Expected metrics
- Selector quality score: 0.80
- Smell count delta: -2
- LOC delta: 6
