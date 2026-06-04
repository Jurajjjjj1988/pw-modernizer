"""Driver factory wrapping Chrome WebDriver setup."""

import os

from selenium import webdriver
from selenium.webdriver.chrome.options import Options


def build_driver():
    """Return a configured Chrome WebDriver.

    Reads HEADLESS env var (default: "1") and OPTS_WINDOW_SIZE (default:
    "1366,768"). Adds the usual flags to keep CI runs stable.
    """
    options = Options()
    if os.environ.get("HEADLESS", "1") == "1":
        options.add_argument("--headless=new")
    options.add_argument(
        f"--window-size={os.environ.get('OPTS_WINDOW_SIZE', '1366,768')}"
    )
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    return webdriver.Chrome(options=options)
