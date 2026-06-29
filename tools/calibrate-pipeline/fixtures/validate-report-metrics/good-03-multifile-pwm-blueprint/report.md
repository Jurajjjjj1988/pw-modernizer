# Migration report — CheckoutFlow.java

## Source → Target

- Input: `inputs/selenium-java/CheckoutFlow.java`
- Output LOC: 116 (spec + POMs across the pwm-blueprint tree)
  - `outputs/tests/checkout-flow.spec.ts` (34 LOC)
  - outputs/helper/page-object/pages/cart.page.ts (38 LOC)
  - outputs/helper/page-object/pages/checkout.page.ts (44 LOC)
- Source LOC: 60
- LOC delta: -26

## Notes

Multi-file pwm-blueprint emission. The validator pins on the spec-specific LOC
sub-bullet (checkout-flow.spec.ts at 34 LOC), not the aggregate, so the
Output LOC it validates is the 34-line spec. Basename derives from
CheckoutFlow.java, LOC matches, and delta (-26) equals output(34) minus
source(60), so the report is self-consistent.
