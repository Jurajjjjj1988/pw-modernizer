# selenium-java-conformance / good / 03-selenium-java-cart

Migrated from a JUnit 5 + WebDriver add-to-cart test (Thread.sleep between
steps). The pwm-blueprint output moves the cart interaction into a `CartPage` POM,
replaces every sleep with a web-first assertion, and uses role-based locators.

Calibration intent: the pwm-blueprint conformance validator must accept this as
clean (zero block-severity violations).
