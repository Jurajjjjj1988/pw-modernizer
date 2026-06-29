# selenium-java-conformance / good / 01-selenium-java-product-search

Migrated from `examples/selenium-java-01-search/input.java`. JUnit 5 +
WebDriver source drives a product search + result-count assertion. Pwm-blueprint
output moves the form interaction into a `ProductSearchPage` POM, drops
`WebDriverWait` for Playwright auto-wait, and uses role-based locators.

Calibration intent: the pwm-blueprint conformance validator must accept this
as clean (zero block-severity violations).
