"""Login flow tests against the staging environment.

Mirrors examples/selenium-java-03-multifile-login/input/LoginTest.java in
Python to give the migrator a parity case for multi-file Selenium-Python.
"""

import pytest

from helpers.driver_config import DriverConfig
from pages.login_page import LoginPage


@pytest.fixture
def login_page():
    page = LoginPage()
    page.open()
    yield page
    DriverConfig.quit()


def test_valid_credentials_land_on_dashboard(login_page):
    login_page.sign_in("jane.doe@acme.test", "Sup3rSecret!")
    assert login_page.is_on_dashboard()
    assert "Welcome, Jane" in login_page.driver.page_source


def test_invalid_credentials_show_error(login_page):
    login_page.sign_in("jane.doe@acme.test", "WrongPassword!")
    error_text = login_page.error_message_text()
    assert error_text == "Invalid email or password"
