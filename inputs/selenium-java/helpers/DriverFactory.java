package com.beacon.hr.helpers;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.time.Duration;

public final class DriverFactory {

    private static final ThreadLocal<WebDriver> DRIVER = new ThreadLocal<>();

    private DriverFactory() {}

    public static WebDriver get() {
        if (DRIVER.get() == null) {
            ChromeOptions opts = new ChromeOptions();
            opts.addArguments("--headless=new");
            WebDriver d = new ChromeDriver(opts);
            d.manage().timeouts().implicitlyWait(Duration.ofSeconds(8));
            d.manage().window().maximize();
            DRIVER.set(d);
        }
        return DRIVER.get();
    }

    public static void dispose() {
        WebDriver d = DRIVER.get();
        if (d != null) {
            d.quit();
            DRIVER.remove();
        }
    }
}
