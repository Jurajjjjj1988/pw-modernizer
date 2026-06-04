/// <reference types="cypress" />

describe('Settings - conditional flows + jQuery escapes', () => {
  beforeEach(() => {
    cy.visit('/settings');
    cy.wait(500);
  });

  it('dismisses cookie banner if present', () => {
    cy.get('body').then(($body) => {
      if ($body.find('.cookie-banner').length > 0) {
        cy.get('.cookie-banner').contains('Accept').click();
      }
    });

    cy.get('h1').should('contain', 'Settings');
  });

  it('toggles dark mode and asserts via jQuery', () => {
    cy.get('input[name="darkMode"]').check({ force: true });

    cy.get('html').then(($html) => {
      expect($html.attr('data-theme')).to.equal('dark');
    });

    cy.get('.theme-preview').should('have.css', 'background-color', 'rgb(20, 20, 20)');
  });

  it('saves and verifies via cy.window store probe', () => {
    cy.get('input[name="displayName"]').clear().type('Alice');
    cy.contains('Save').click();

    cy.wait(1500);

    cy.window().its('app.store').invoke('getState').should('deep.include', {
      profile: { displayName: 'Alice' },
    });
  });
});
