"""Page Object for the employees list page (legacy Selenium-Python style)."""

from selenium.webdriver.common.by import By


class EmployeesPage:
    """Wraps the employees list surface."""

    SEARCH_BOX = (By.ID, "search-input")
    SEARCH_BUTTON = (By.CSS_SELECTOR, "form.search button[type='submit']")
    ADD_NEW_BUTTON = (By.XPATH, "//button[contains(text(), 'Add new')]")
    EMPTY_STATE = (By.CSS_SELECTOR, ".empty-state")
    LOADER = (By.CLASS_NAME, "spinner")

    def __init__(self, driver):
        self.driver = driver

    @property
    def search_box(self):
        return self.driver.find_element(*self.SEARCH_BOX)

    @property
    def search_button(self):
        return self.driver.find_element(*self.SEARCH_BUTTON)

    @property
    def add_new_button(self):
        return self.driver.find_element(*self.ADD_NEW_BUTTON)

    def is_loader_visible(self):
        try:
            return self.driver.find_element(*self.LOADER).is_displayed()
        except Exception:
            return False
