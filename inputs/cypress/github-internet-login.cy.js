/// <reference types="cypress" />
context ('Login page',()=>{
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/login')
      })
    it ('without data',()=>{
      cy.get('#login button').click()
      cy.get('#flash').should('be.visible').and('contain','Your username is invalid!')
    })
    it ('with name',()=>{
      cy.get('#username').type('tomsmith')
      cy.get('#login button').click()
      cy.get('#flash').should('be.visible').and('contain','Your password is invalid!')
    })
    it ('with all data',()=>{
      cy.get('#username').type('tomsmith')
      cy.get('#password').type('SuperSecretPassword!')
      cy.get('#login button').click()
      cy.get('a').contains('Logout').click()
      cy.get('#flash').should('be.visible').and('contain',' You logged')
    })
})