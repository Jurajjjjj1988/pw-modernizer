# Migration plan: input.spec.ts

## Source framework
selenium-java

## Summary
Multi-failure plan exercising both axis simultaneously: a phantom
KB-2.99.99 reference AND an orphan Q-mystery slug in the pins section.
The validator must emit BOTH violations (one per axis).

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet | Replacement |
|---|---|---|---|---|---|
| H | 15 | KB-1.3.1 | hard-wait | `Thread.sleep(1500)` | web-first assertion |
| H | 22 | KB-2.99.99 | future-smell | `something()` | something else |

## Hallucination-defense pins

1. **Mystery element** — assumed `page.getByTestId('mystery')`.
   WHY-comment: `Q-mystery unresolved: element identity unknown`.
   Reviewer fallback: ask FE team to confirm.

## Open questions for reviewer

- Q-other: a different question is listed here.

## Risk callouts
This plan should fail validation on TWO counts. Phantom KB cite and
orphan pin slug — see fixture filename + this section's text intentionally
avoids restating either ID so the parser does not see them in scope.

## Expected metrics
- Selector quality score: 0.7
- Smell count delta: -2
- LOC delta: 8
