import time

import pytest
from selenium import webdriver
from selenium.webdriver.common.by import By


@pytest.fixture
def browser():
    drv = webdriver.Chrome()
    drv.implicitly_wait(5)
    yield drv
    drv.quit()


def test_admin_authenticates(browser):
    browser.get("https://app.acme.test/signin")
    browser.find_element(By.ID, "userField").send_keys("admin@acme.test")
    browser.find_element(By.ID, "pwField").send_keys("supersecret")
    browser.find_element(By.XPATH, "//form//button[@type='submit']").click()

    time.sleep(2)

    banner = browser.find_element(By.CSS_SELECTOR, ".home-banner").text
    assert banner == "Welcome, Administrator"
