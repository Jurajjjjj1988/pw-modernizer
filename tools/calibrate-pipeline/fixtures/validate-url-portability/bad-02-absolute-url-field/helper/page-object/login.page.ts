import { BasePage } from '@page-object/basepage';

export class LoginPage extends BasePage {
  readonly url = 'https://the-internet.herokuapp.com/login';
  async open(): Promise<void> { await this.page.goto(this.url); }
}
