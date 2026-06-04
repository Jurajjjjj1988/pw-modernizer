"""Driver lifecycle — module-level singleton shared across tests (anti-pattern)."""

from selenium import webdriver
from selenium.webdriver.chrome.options import Options


class DriverConfig:
    _driver = None

    @classmethod
    def get(cls):
        if cls._driver is None:
            options = Options()
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            cls._driver = webdriver.Chrome(options=options)
            cls._driver.implicitly_wait(5)
        return cls._driver

    @classmethod
    def quit(cls):
        if cls._driver is not None:
            cls._driver.quit()
            cls._driver = None
