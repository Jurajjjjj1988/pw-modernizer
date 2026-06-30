// Legacy Cypress: a STUB (3rd-arg response object) that pins the checkout
// response, asserted on via .then(). The migration must reflect it with a
// fulfilled page.route(...) AND a page.waitForResponse(...) that reads the response.
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
