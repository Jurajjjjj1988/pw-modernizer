"""Selenium WebDriver (Python) test exercising legacy patterns.

Tested behaviors:
- Open employees list, filter by department, click a row, assert details.
- Validate add-employee form rejects empty submission.

Smells: thread sleep, implicit wait, find_element with XPath, page_source
substring assertions, manual try/except as a presence check, fixture
sprawl (pytest fixture + manual driver setup).
"""

import time

import pytest
from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from helpers.driver_factory import build_driver
from pages.employees_page import EmployeesPage


@pytest.fixture
def driver():
    drv = build_driver()
    drv.implicitly_wait(10)
    yield drv
    drv.quit()


def test_filter_by_engineering_department(driver):
    driver.get("https://staging.example.com/employees")
    time.sleep(2)

    page = EmployeesPage(driver)
    page.search_box.clear()
    page.search_box.send_keys("Engineering")
    page.search_button.click()

    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, "table.employees-table tbody tr"))
    )

    rows = driver.find_elements(By.XPATH, "//table[@class='employees-table']//tbody//tr")
    assert len(rows) >= 1

    rows[0].click()
    time.sleep(1)
    assert "Department: Engineering" in driver.page_source


def test_add_employee_form_rejects_empty_submission(driver):
    driver.get("https://staging.example.com/employees/new")
    submit = driver.find_element(By.CSS_SELECTOR, "form button[type='submit']")
    submit.click()

    try:
        error = driver.find_element(By.CSS_SELECTOR, ".form-error")
        assert error.is_displayed()
    except NoSuchElementException:
        pytest.fail("Expected validation error to render, but .form-error not found")

    assert "First name is required" in driver.page_source
