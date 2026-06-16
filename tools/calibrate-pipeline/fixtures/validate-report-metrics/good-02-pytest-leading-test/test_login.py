import pytest
from selenium import webdriver
from selenium.webdriver.common.by import By


def test_login_lands_on_dashboard():
    driver = webdriver.Chrome()
    driver.get("https://example.test/login")
    driver.find_element(By.ID, "user").send_keys("standard_user")
    driver.find_element(By.ID, "password").send_keys("secret_sauce")
    driver.find_element(By.ID, "login").click()
    assert driver.find_element(By.CSS_SELECTOR, "h1.welcome").is_displayed()
    driver.quit()
