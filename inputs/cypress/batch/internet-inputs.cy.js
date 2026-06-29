/// <reference types="cypress" />
context ('Inputs',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/inputs')
      })
    it ('type into input',()=>{
      cy.get('.example input').type('5')
      Cypress._.times(10, () => {
        cy.get('.example input').type('{upArrow}')
      })
      cy.get('.example input').should('have.value','15')
    })
})