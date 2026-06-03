# Migration plan: trivial-fix.spec.ts

## Source framework
bad-playwright

## Summary
Single-test smoke flow with no anti-patterns detected — clean reference
plan that exercises the validator on the empty cross-ref case. Plan
deliberately contains zero KB-IDs and zero Q-IDs to confirm the
validator does not false-positive on the "nothing to check" path.

## Anti-patterns detected
None — input is already clean. No KB-IDs needed.

## Hallucination-defense pins
None — every locator in the input already uses role/label semantics.

## Open questions for reviewer
None — input is fully grounded against the live DOM (already inspected).

## Structural changes
- Extract POM: no — single test, no shared state.
- Extract fixture: no — only a single `goto`.
- Split into multiple specs: no.

## Risk callouts
None — straight pass-through with no semantic drift.

## Expected metrics
- Selector quality score: 1.0 (input already at 1.0)
- Smell count delta: 0
- LOC delta: 0
