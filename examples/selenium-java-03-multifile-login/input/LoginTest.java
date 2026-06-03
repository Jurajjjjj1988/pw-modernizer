package com.acme.shop.tests;

import com.acme.shop.helpers.WebDriverConfig;
import com.acme.shop.pages.LoginPage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class LoginTest {

    private LoginPage loginPage;

    @BeforeEach
    void setUp() {
        loginPage = new LoginPage();
        loginPage.open();
    }

    @AfterEach
    void tearDown() {
        WebDriverConfig.quit();
    }

    @Test
    void validCredentialsLandOnDashboard() throws InterruptedException {
        loginPage.signIn("jane.doe@acme.test", "Sup3rSecret!");
        assertTrue(loginPage.isOnDashboard());
        assertTrue(loginPage.currentUrl().contains("/dashboard"));
    }

    @Test
    void invalidCredentialsShowErrorBanner() throws InterruptedException {
        loginPage.signIn("jane.doe@acme.test", "wrong-password");
        assertTrue(loginPage.hasError());
        assertEquals("Invalid credentials", loginPage.errorText());
    }
}
