package com.acme.shop.tests;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;

import static org.junit.jupiter.api.Assertions.assertTrue;

public class LoginTest {

    private WebDriver driver;

    @BeforeEach
    void setUp() {
        driver = new ChromeDriver();
        driver.get("https://app.acme.test/login");
    }

    @AfterEach
    void tearDown() {
        driver.quit();
    }

    @Test
    void validCredentialsLandOnDashboard() throws InterruptedException {
        driver.findElement(By.id("email")).sendKeys("jane@acme.test");
        driver.findElement(By.id("password")).sendKeys("hunter2");
        driver.findElement(By.cssSelector("button.primary")).click();
        Thread.sleep(2000);
        WebElement dashboard = driver.findElement(By.cssSelector(".dashboard-greeting"));
        assertTrue(dashboard.isDisplayed());
    }
}
