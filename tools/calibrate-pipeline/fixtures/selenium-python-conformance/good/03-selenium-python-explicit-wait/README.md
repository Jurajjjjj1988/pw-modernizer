# good / 03-selenium-python-explicit-wait

Represents the qa-master Stage 2 output a clean migration of
`examples/selenium-python-03-multifile-login/input/test_login.py` (+
`pages/login_page.py`) should produce — specifically the
`is_on_dashboard()` flow that ceremoniously wraps `WebDriverWait(driver,
5).until(EC.presence_of_element_located(...))` around a dashboard header
locator. The selenium source also used `find_element` with positional XPath
(`//header//h1[contains(text(), 'Dashboard')]`), read pass/fail via
`page_source` substring (`"Welcome, Jane" in login_page.driver.page_source`),
and asserted the error message via raw `element.text` equality. This "good"
version models the login surface as a `PageClassLogin` that extends
`BasePage` (no own constructor, `readonly` locator fields with `.describe()`
labels, navigation owned by `open()`), replaces every `WebDriverWait` +
`page_source` probe with web-first auto-waiting assertions (`expect(...)
.toHaveURL(/\/dashboard/)`, `expect(headingDashboard).toBeVisible()`), lifts
the XPath dashboard header to `getByRole('heading', { name: 'Dashboard' })`,
routes `test`/`expect` through `@fixtures/base.fixture`, and names tests as
`[QA-601] - Check that …`. It is the calibration target the conformance
validator must accept as clean.
