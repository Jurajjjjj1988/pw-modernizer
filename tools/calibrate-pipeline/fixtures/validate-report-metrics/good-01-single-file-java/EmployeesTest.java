package com.example.tests;

import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class EmployeesTest {
    @Test
    public void knownEmployeeRowRenders() {
        WebDriver driver = new ChromeDriver();
        driver.get("https://example.test/employees");
        boolean present = driver.findElements(By.id("row-ada-lovelace")).size() > 0;
        assertTrue(present);
        driver.quit();
    }
}
