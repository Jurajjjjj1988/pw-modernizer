// Legacy Cypress: a STUB that pins the checkout response. The codemod DROPPED the
// stub during migration — the confirmed false-green: the migrated test runs against
// the real backend because the route that controlled the response is gone.
describe('checkout', () => {
  it('pays', () => {
    cy.intercept('POST', '/api/checkout/pay', { statusCode: 201, body: { orderId: 'ord_1' } }).as('payReq');
    cy.visit('/checkout');
    cy.get('button.pay-now').click();
    cy.wait('@payReq').then((interception) => {
      expect(interception.response.statusCode).to.equal(201);
    });
  });
});
