/// <reference types="cypress" />
context ('Select',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/dropdown')
      })
    it ('select first option',()=>{
      cy.get('#dropdown').select('Option 1')
      cy.get('#dropdown').should('have.value', '1')
    })
})