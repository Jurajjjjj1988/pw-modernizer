/// <reference types="cypress" />

// Wishlist add + remove flow on Acme Shop. Tests pass locally but rely on
// hard waits, brittle CSS class chains, and a "cy.contains then click"
// pattern that doubles as both a locator and an assertion.

describe('Acme Shop wishlist', () => {
  beforeEach(() => {
    cy.viewport(1366, 768);
    cy.intercept('GET', '/api/wishlist').as('wishlistLoad');
    cy.visit('/products');
    cy.wait(1500);
  });

  it('adds a product to the wishlist from a product card', () => {
    cy.get('div.product-grid article.product-card').eq(0).within(() => {
      cy.get('button.add-to-wishlist').click();
    });

    cy.wait(1000);

    cy.contains('Added to wishlist').should('be.visible');
    cy.get('.header-wishlist-count').should('contain.text', '1');

    cy.get('a.header-wishlist-link').click();
    cy.wait('@wishlistLoad');
    cy.wait(2000);

    cy.get('.wishlist-page .wishlist-item').its('length').should('eq', 1);
  });

  it('removes a product from the wishlist and restores the empty state', () => {
    cy.get('div.product-grid article.product-card').eq(2).within(() => {
      cy.get('button.add-to-wishlist').click();
    });
    cy.wait(1200);

    cy.get('a.header-wishlist-link').click();
    cy.wait('@wishlistLoad');
    cy.wait(2000);

    // Probe-then-assert pattern - if the locator is gone we silently move on.
    if (cy.get('.wishlist-item button.remove-from-wishlist').should('exist')) {
      cy.get('.wishlist-item button.remove-from-wishlist').first().click();
    }
    cy.wait(1500);

    cy.get('.empty-wishlist-message').should('be.visible');
    cy.get('.header-wishlist-count').should('contain.text', '0');
  });
});
