# selenium-java-conformance / bad / 02-selenium-java-login-own-constructor

Same scenario as `good/02-selenium-java-login` but seeded with ONE
block-severity violation the qa-master validator must reject:

1. `PageClassLogin` declares its own `constructor(page)` —
   `qa-master/architecture/no-constructor`. Only BasePage/BaseBlock may
   declare constructors; subclasses use readonly fields referencing
   `this.page`.

Everything else in the tree is qa-master clean, so this fixture isolates the
single rule for unambiguous calibration.
