package com.acme.shop.tests;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertTrue;

public class LoginTest {

    private WebDriver driver;
    private WebDriverWait wait;

    @BeforeEach
    void setUp() {
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
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
        WebElement dashboard = wait.until(
            ExpectedConditions.visibilityOfElementLocated(By.cssSelector(".dashboard-greeting"))
        );
        assertTrue(dashboard.isDisplayed());
    }
}
