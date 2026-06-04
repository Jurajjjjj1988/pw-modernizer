package com.acme.shop.tests;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;

import static org.junit.jupiter.api.Assertions.assertTrue;

public class AuthTest {

    private WebDriver browser;

    @BeforeEach
    void initialize() {
        browser = new ChromeDriver();
        browser.get("https://app.acme.test/signin");
    }

    @AfterEach
    void cleanup() {
        browser.quit();
    }

    @Test
    void adminAuthLandsOnHome() throws InterruptedException {
        browser.findElement(By.id("usernameField")).sendKeys("admin@acme.test");
        browser.findElement(By.id("pwField")).sendKeys("supersecret");
        browser.findElement(By.cssSelector("button.primary")).click();
        Thread.sleep(2000);
        WebElement homeBanner = browser.findElement(By.cssSelector(".home-banner"));
        assertTrue(homeBanner.isDisplayed());
    }
}
