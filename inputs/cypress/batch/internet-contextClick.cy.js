/// <reference types="cypress" />
context ('Right click',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/context_menu')
      })
    it ('rightclick',()=>{
      cy.get('#hot-spot').rightclick()  
    })

})