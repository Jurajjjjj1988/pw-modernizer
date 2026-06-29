/// <reference types="cypress" />
context ('CheckBox',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/checkboxes')
      })
    it ('CheckBox checked',()=>{
      cy.get('#checkboxes [type="checkbox"]').not('[checked]')
      .check().should('be.checked')  
    })

})