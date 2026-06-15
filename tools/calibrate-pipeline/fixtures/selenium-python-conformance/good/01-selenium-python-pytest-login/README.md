# good / 01-selenium-python-pytest-login

Represents the qa-master Stage 2 output a clean migration of
`examples/selenium-python-01-login/input.py` should produce. The pytest+
selenium source declared a `driver` fixture (`webdriver.Chrome()` +
`implicitly_wait(5)`), a `logged_in_driver` fixture that re-drove login on
every test, located inputs by `By.ID('email')`/`By.ID('password')` and the
submit button by `By.XPATH("//form//button[@type='submit']")`, then
`time.sleep(2)` after submit before reading `.dashboard-greeting` and the
`.kpi-card .kpi-value` chain. This "good" version models the login surface
as a `PageClassLogin` that extends `BasePage` (no own constructor,
`readonly` locator fields with `.describe()` labels, navigation owned by
`open()`), routes `test`/`expect` through `@fixtures/base.fixture`, names
tests as `[QA-20x] - Check that …`, replaces every `time.sleep` and
`WebDriverWait` with web-first auto-waiting assertions, and lifts the
selenium CSS / XPath selectors to `getByLabel` / `getByRole` /
`getByTestId` per qa-master selector priority. It is the calibration target
the conformance validator must accept as clean.
