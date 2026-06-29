/// <reference types="cypress" />
context ('iframe',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/iframe')
      })
      const getIframeDocument = () => {
        return cy
        .get('#mce_0_ifr').eq(0)
        .its('0.contentDocument').should('exist')
      }
      const getIframeBody = () => {
        return getIframeDocument().find('p')
        .then(cy.wrap)
      }
      it('gets the post', () => {
        getIframeDocument().should('contain.text', 'Your content goes here')
      })
})