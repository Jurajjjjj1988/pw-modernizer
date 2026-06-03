package com.acme.shop.helpers;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.time.Duration;

/**
 * Per-thread driver provider. Parallel TestNG / JUnit runners require driver
 * isolation per worker thread; ThreadLocal keeps each thread's driver
 * independent. Carries known issues: lazy null-check pattern, hidden
 * implicit wait global, no explicit dispose ownership.
 */
public final class WebDriverConfig {

    private static final ThreadLocal<WebDriver> DRIVER = new ThreadLocal<>();

    private WebDriverConfig() {}

    public static WebDriver getDriver() {
        if (DRIVER.get() == null) {
            ChromeOptions opts = new ChromeOptions();
            opts.addArguments("--headless=new");
            WebDriver d = new ChromeDriver(opts);
            d.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
            d.manage().window().maximize();
            DRIVER.set(d);
        }
        return DRIVER.get();
    }

    public static void quit() {
        WebDriver d = DRIVER.get();
        if (d != null) {
            d.quit();
            DRIVER.remove();
        }
    }
}
