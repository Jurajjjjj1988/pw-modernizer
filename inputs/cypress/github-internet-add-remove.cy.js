/// <reference types="cypress" />
context ('Add/Remove Elements',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/add_remove_elements/')
      })
    
    it ('Add few elements and check it',()=>{
        
        cy.get('.example button').click().click().click()

        cy.get('#elements').find('button').should('have.length', 3)
    })
    it ('Delete few elements and check it',()=>{
        cy.get('#elements').find('button').first().click()
        cy.get('#elements').find('button').should('have.length', 2)
    })
    it ('Delete all elements and check it',()=>{
        cy.get('#elements').find('button').click({ multiple: true })
        cy.get('#elements').find('button').should('have.length', 0)
    })
})