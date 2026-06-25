// Legacy Cypress test against the REAL the-internet app (stable public demo).
// Brittle on purpose: hard wait + id/CSS selectors + substring assertion.
describe('the-internet secure login', () => {
  it('logs in and reaches the secure area', () => {
    cy.visit('https://the-internet.herokuapp.com/login');
    cy.get('#username').type('tomsmith');
    cy.get('#password').type('SuperSecretPassword!');
    cy.wait(500);
    cy.get('button[type="submit"]').click();
    cy.get('.flash.success').should('contain', 'You logged into a secure area');
    cy.get('a.button.secondary').should('contain', 'Logout');
  });
});
