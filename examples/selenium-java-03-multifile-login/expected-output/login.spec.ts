/**
 * Acme Shop - login (multi-file Selenium suite -> single Playwright spec).
 *
 * Two scenarios: valid credentials route the user to /dashboard; invalid
 * credentials show an error banner with the message "Invalid credentials".
 *
 * Source: 4 Java files (BasePage, LoginPage, WebDriverConfig, LoginTest),
 * 163 LOC. Target: 1 POM + 1 spec, ~60 LOC. The BasePage and WebDriverConfig
 * helpers fold into Playwright's built-in `page` fixture; LoginPage becomes
 * a slim 35-LOC POM with role-based locators.
 */
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/login.page';

test.describe('Acme Shop - login', () => {
  test('lands on the dashboard with valid credentials @positive', async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.signIn('jane.doe@acme.test', 'Sup3rSecret!');

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows an error banner with invalid credentials @negative', async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.signIn('jane.doe@acme.test', 'wrong-password');

    await expect(login.errorBanner).toBeVisible();
    await expect(login.errorBanner).toHaveText('Invalid credentials');
  });
});
