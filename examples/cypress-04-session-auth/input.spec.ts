/// <reference types="cypress" />

describe('Order management - authenticated dashboard', () => {
  beforeEach(() => {
    cy.session(
      'admin',
      () => {
        cy.visit('/login');
        cy.get('#email').type('admin@example.test');
        cy.get('#password').type('AdminPass123');
        cy.get('button[type="submit"]').click();
        cy.url().should('include', '/dashboard');
      },
      { cacheAcrossSpecs: true },
    );
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/dashboard/orders');
  });

  it('lists existing orders', () => {
    cy.get('.order-list').should('be.visible').should('contain', 'Orders');
    cy.get('.order-row').its('length').should('be.gte', 1);
  });

  it('opens an order by index', () => {
    cy.get('.order-row').eq(0).click();
    cy.url().should('match', /\/dashboard\/orders\/ord_[a-z0-9]+/);
    cy.contains('Order details').should('exist');
  });
});
