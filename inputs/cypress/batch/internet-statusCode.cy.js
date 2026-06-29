/// <reference types="cypress" />
context ('Status code',()=>{
  let linkArr = [];
  let url = 'https://the-internet.herokuapp.com/'
    before(() => {
        cy.visit('https://the-internet.herokuapp.com/status_codes')
        cy.get('ul a').each(($elem)=>{
          cy.wrap($elem).should('have.attr', 'href')
            .then((href) => {
              linkArr.push(href)
            })
     
        })
      })
    beforeEach(()=>{
      cy.visit('https://the-internet.herokuapp.com/status_codes')
    })
    it ('Status code must be 200',()=>{
      cy.intercept('GET', url+linkArr[0]).as('200') 
      cy.contains('a', '200').click()
      cy.wait('@200')          // wait for intercept instead of cy.wait(3000)
        .then(interception => {
          expect(interception.response.statusCode).to.eq(200)
        })
    })
    it ('Status code must be 300',()=>{
      cy.intercept('GET', url+linkArr[1]).as('300') 
      cy.contains('a', '301').click()
      cy.wait('@300')          // wait for intercept instead of cy.wait(3000)
        .then(interception => {
          expect(interception.response.statusCode).to.eq(301)
        })
    })
    it ('Status code must be 404',()=>{
      cy.intercept('GET', url+linkArr[2]).as('404') 
      cy.contains('a', '404').click()
      cy.wait('@404')          // wait for intercept instead of cy.wait(3000)
        .then(interception => {
          expect(interception.response.statusCode).to.eq(404)
        })
    })
    it ('Status code must be 500',()=>{
      cy.intercept('GET', url+linkArr[3]).as('500') 
      cy.contains('a', '500').click()
      cy.wait('@500')          // wait for intercept instead of cy.wait(3000)
        .then(interception => {
          expect(interception.response.statusCode).to.eq(500)
        })
    })
})