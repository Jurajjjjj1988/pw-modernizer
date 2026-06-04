"""Base page — shared driver lifecycle for all POMs (god-class anti-pattern)."""

from selenium.webdriver.support.ui import WebDriverWait

from helpers.driver_config import DriverConfig


class BasePage:
    """Inherited by every Page Object. Stores driver + wait + base URL."""

    BASE_URL = "https://staging.acme.test"

    def __init__(self):
        self.driver = DriverConfig.get()
        self.wait = WebDriverWait(self.driver, 10)

    def open(self):
        self.driver.get(self.BASE_URL + self.PATH)
