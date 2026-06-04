import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/login.page';

test.describe('Login flow', () => {
  // plan:scenario=1.1
  test('valid credentials land on dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.signIn('jane.doe@acme.test', 'Sup3rSecret!');
    await expect(loginPage.dashboardHeading).toBeVisible();
    await expect(page.getByText('Welcome, Jane')).toBeVisible();
  });

  // plan:scenario=1.2
  test('invalid credentials show inline error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.signIn('jane.doe@acme.test', 'WrongPassword!');
    await expect(loginPage.errorMessage).toHaveText('Invalid email or password');
  });
});
