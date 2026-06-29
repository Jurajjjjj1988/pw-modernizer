# selenium-java-conformance / bad / 03-selenium-java-cart-expect-no-label

Same scenario as `good/03-selenium-java-cart` but seeded with ONE
block-severity violation the pwm-blueprint validator must reject:

1. The `addBackpack()` page method's assertion omits its `[LABEL] WHY`
   message argument — `pwm-blueprint/architecture/expect-no-label`. Page-method
   assertions must carry a labelled failure message.

Everything else in the tree is pwm-blueprint clean, so this fixture isolates the
single rule for unambiguous calibration.
