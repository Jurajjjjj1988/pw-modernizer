"""LoginPage — exercises common Selenium-Python smells.

- WebDriverWait + ExpectedConditions ceremony
- find_element with positional XPath
- page_source substring assertion for dashboard check
- assertion via raw element.text equality
"""

import time

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from pages.base_page import BasePage


class LoginPage(BasePage):
    PATH = "/sign-in"

    EMAIL_INPUT = (By.ID, "email")
    PASSWORD_INPUT = (By.ID, "password")
    SUBMIT_BUTTON = (By.XPATH, "//form//button[@type='submit']")
    ERROR_MESSAGE = (By.CSS_SELECTOR, ".form-error")
    DASHBOARD_HEADER = (By.XPATH, "//header//h1[contains(text(), 'Dashboard')]")

    def sign_in(self, email, password):
        self.driver.find_element(*self.EMAIL_INPUT).send_keys(email)
        self.driver.find_element(*self.PASSWORD_INPUT).send_keys(password)
        self.driver.find_element(*self.SUBMIT_BUTTON).click()
        time.sleep(1)

    def is_on_dashboard(self):
        try:
            WebDriverWait(self.driver, 5).until(
                EC.presence_of_element_located(self.DASHBOARD_HEADER)
            )
            return True
        except Exception:
            return False

    def error_message_text(self):
        return self.driver.find_element(*self.ERROR_MESSAGE).text
