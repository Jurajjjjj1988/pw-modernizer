/// <reference types="cypress" />
context ('Hovers',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/hovers')
      })
      it('check hovers', () => {
        cy.get('#content .figure').each(($elem)=>{
          cy.wrap($elem).realHover('mouse')
          cy.wrap($elem).find('h5').should('be.visible')
        })
      })
})