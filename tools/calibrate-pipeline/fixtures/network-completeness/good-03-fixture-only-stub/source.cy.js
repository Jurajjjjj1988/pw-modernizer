// Legacy Cypress: a {fixture} STUB for the products list. The migration parked the
// route stub in a MOCK FIXTURE (helper/fixtures/products-mocks.fixture.ts), not the
// spec — the fixture-scan must fold that file in so the stub is seen as reflected.
describe('products', () => {
  it('lists products', () => {
    cy.intercept('GET', '/api/products', { fixture: 'products.json' }).as('prods');
    cy.visit('/products');
    cy.get('[data-testid="grid"]').should('be.visible');
  });
});
