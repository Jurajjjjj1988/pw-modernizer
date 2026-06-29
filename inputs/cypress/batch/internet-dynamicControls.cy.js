/// <reference types="cypress" />
context ('Dynamic Controls',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/dynamic_controls')
      })
    it ('Type text after click',()=>{
      cy.get('#input-example button').click('')
      cy.get('#input-example input').type('Some text')
      cy.get('#input-example input').should('have.value','Some text')
    })
})