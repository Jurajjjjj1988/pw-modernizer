/// <reference types="cypress" />

describe('Checkout - cart and payment intercepts', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/cart').as('getCart');
    cy.intercept('POST', '/api/checkout/pay').as('payReq');
    cy.intercept('POST', '/api/checkout/pay', { times: 1 }).as('firstPay');
    cy.visit('/cart');
    cy.wait('@getCart');
  });

  it('completes a credit-card checkout', () => {
    cy.get('.cart-row').should('have.length.gte', 1);
    cy.contains('Checkout').click();

    cy.get('input[name="card"]').type('4242 4242 4242 4242');
    cy.get('input[name="exp"]').type('12/30');
    cy.get('input[name="cvc"]').type('123');
    cy.get('button.pay-now').click();

    cy.wait('@payReq').then((interception) => {
      expect(interception.response.statusCode).to.equal(201);
      expect(interception.response.body.orderId).to.match(/^ord_/);
    });

    cy.url().should('include', '/order-confirmed');
    cy.contains('Order confirmed').should('be.visible');
  });

  it('retries on first 500 then succeeds', () => {
    cy.intercept('POST', '/api/checkout/pay', { times: 1, statusCode: 500 }).as('firstFail');
    cy.intercept('POST', '/api/checkout/pay', { statusCode: 201, body: { orderId: 'ord_retry' } }).as('retrySuccess');

    cy.contains('Checkout').click();
    cy.get('input[name="card"]').type('4242 4242 4242 4242');
    cy.get('input[name="exp"]').type('12/30');
    cy.get('input[name="cvc"]').type('123');
    cy.get('button.pay-now').click();

    cy.wait('@firstFail');
    cy.wait('@retrySuccess');
    cy.url().should('include', '/order-confirmed');
  });
});
