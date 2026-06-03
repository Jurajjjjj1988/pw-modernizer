package com.acme.shop.pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.How;
import org.openqa.selenium.support.ui.ExpectedConditions;

public class LoginPage extends BasePage {

    private static final String URL = "https://shop.acme.test/login";

    @FindBy(id = "email") private WebElement emailInput;
    @FindBy(id = "password") private WebElement passwordInput;
    @FindBy(how = How.XPATH, using = "//form//button[@type='submit']") private WebElement signInButton;
    @FindBy(css = ".error-banner") private WebElement errorBanner;

    public void open() {
        driver.get(URL);
    }

    public void signIn(String email, String password) throws InterruptedException {
        emailInput.clear();
        emailInput.sendKeys(email);
        passwordInput.clear();
        passwordInput.sendKeys(password);
        signInButton.click();
        Thread.sleep(1500);
    }

    public boolean isOnDashboard() {
        return wait.until(ExpectedConditions.urlContains("/dashboard"));
    }

    public String errorText() {
        waitVisible(errorBanner);
        return errorBanner.getText();
    }

    public boolean hasError() {
        return isVisibleSafe(By.cssSelector(".error-banner"));
    }
}
