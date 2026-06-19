# selenium-java-conformance / good / 02-selenium-java-login

Migrated from a JUnit 5 + WebDriver login test (By.id + WebDriverWait). The
qa-master output moves the form interaction into a `LoginPage` POM, drops the
explicit wait for Playwright auto-wait, and uses role-based locators.

Calibration intent: the qa-master conformance validator must accept this as
clean (zero block-severity violations).
