// Legacy Cypress test against the REAL saucedemo app (https://www.saucedemo.com).
// Deliberately brittle: hard waits + id/CSS selectors + index assertion.
describe('SauceDemo login flow', () => {
  it('logs in as standard_user and shows the inventory', () => {
    cy.visit('https://www.saucedemo.com/');
    cy.get('#user-name').type('standard_user');
    cy.get('#password').type('secret_sauce');
    cy.wait(1000);
    cy.get('#login-button').click();
    cy.wait(2000);
    cy.get('.title').should('have.text', 'Products');
    cy.get('.inventory_item').should('have.length', 6);
    cy.get('.shopping_cart_link').should('be.visible');
  });
});
