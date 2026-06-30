// Legacy Cypress: a SPY (2-arg passthrough) — it only OBSERVES the real call and
// waits for it. No stub body is supplied, so the migration must NOT fabricate a
// route; it must keep the wait as a page.waitForResponse(...) sync point.
describe('cart', () => {
  it('loads the cart', () => {
    cy.intercept('GET', '/api/cart').as('getCart');
    cy.visit('/cart');
    cy.wait('@getCart');
    cy.get('[data-testid="cart"]').should('be.visible');
  });
});
