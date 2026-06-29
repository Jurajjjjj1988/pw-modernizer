package com.example.tests;

import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class CheckoutFlow {
    @Test
    public void singleItemCartCompletesCheckout() throws InterruptedException {
        WebDriver driver = new ChromeDriver();
        driver.get("https://example.test/cart");
        driver.findElement(By.id("add-backpack")).click();
        Thread.sleep(2000);
        driver.findElement(By.id("checkout")).click();
        Thread.sleep(2000);
        driver.findElement(By.id("finish")).click();
        boolean done = driver.findElements(By.id("confirmation")).size() > 0;
        assertTrue(done);
        driver.quit();
    }
}
