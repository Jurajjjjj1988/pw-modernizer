# Migration report — CheckoutFlow.java

## Source → Target

- Input: `inputs/selenium-java/CheckoutFlow.java`
- Output: `outputs/tests/checkout-flow.spec.ts` (23 LOC)
- Source LOC: 60
- Output LOC: 23
- LOC delta: -5

## Notes

Basename derives correctly and the claimed 23 LOC matches the emitted spec,
so checks 1 and 2 pass. The single violation is the LOC delta: claimed -5
but output(23) minus source(60) computes -37.
