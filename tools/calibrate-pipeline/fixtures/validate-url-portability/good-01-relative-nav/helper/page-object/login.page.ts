import { BasePage } from '@page-object/basepage';

// See outputs/plans/login.cy.js.md
export class LoginPage extends BasePage {
  readonly url = '/inventory.html';
  async open(): Promise<void> { await this.page.goto(this.url); }
}
