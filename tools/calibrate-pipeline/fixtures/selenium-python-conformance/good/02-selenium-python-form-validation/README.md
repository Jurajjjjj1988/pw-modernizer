# good / 02-selenium-python-form-validation

Represents the qa-master Stage 2 output a clean migration of the
`test_invite_user_modal_validates_email` scenario from
`examples/selenium-python-02-modal-interaction/input.py` should produce.
The pytest+selenium source spun up a class-scoped Chrome driver via
`BaseTest.setup_class`, navigated `driver.get("https://admin.keystone.test/users")`
in `setup_method`, slept `time.sleep(1)` after every click, and read the
modal's children by positional index — `find_elements(By.CSS_SELECTOR,
".modal input")[0]` for the email field and `find_elements(By.CSS_SELECTOR,
".modal button")[1]` for the submit button — plus a raw `.modal .field-error`
selector for the inline error. This "good" version models the users page +
invite-user modal as a `PageClassUsersAdmin` that extends `BasePage`
(no own constructor, `readonly` locator fields with `.describe()` labels,
navigation owned by `open()`), scopes every modal-child locator through a
single `dialogInviteUser` (`getByRole('dialog', { name: 'Invite a new
user' })`) so the positional indexing disappears, routes `test`/`expect`
through `@fixtures/base.fixture`, names tests as `[QA-401] - Check
that …`, and replaces every `time.sleep` + `WebDriverWait` with web-first
auto-waiting assertions. It is the calibration target the conformance
validator must accept as clean.
