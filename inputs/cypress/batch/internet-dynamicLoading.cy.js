/// <reference types="cypress" />
context ('Dynamic Loading',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/dynamic_loading/1')
      })
    it ('wait when text load',()=>{
      cy.get('#start button').click()
      cy.get('#finish').should('contain','Hello World!')
    })
})