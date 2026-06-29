#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFailureClasses } from "./failure-detectors.js";

/** Classes detected, in the order detectFailureClasses returns them. */
const classes = (source: string, err = "", snap = ""): string[] =>
  detectFailureClasses(source, err, snap).map((d) => d.cls);

test("dialog detected from a Cypress confirm-stub source token", () => {
  const src = "cy.on('window:confirm', () => true); cy.get('#delete').click()";
  const hits = detectFailureClasses(src, "Timeout 30000ms exceeded", "");
  assert.deepEqual(hits.map((h) => h.cls), ["dialog"]);
  assert.match(hits[0]?.hint ?? "", /page\.on\('dialog'/);
});

test("dialog detected from a Selenium switchTo().alert source token", () => {
  assert.deepEqual(classes("driver.switchTo().alert().accept();"), ["dialog"]);
});

test("iframe detected from a Cypress cy.iframe source token", () => {
  const hits = detectFailureClasses("cy.iframe('#editor').find('button').click()", "", "");
  assert.deepEqual(hits.map((h) => h.cls), ["iframe"]);
  assert.match(hits[0]?.hint ?? "", /frameLocator/);
});

test("iframe detected from a 'resolved to 0 elements' run-error alone", () => {
  const err = "locator.click: Error: locator resolved to 0 elements";
  assert.deepEqual(classes("await page.getByRole('button').click()", err, ""), ["iframe"]);
});

test("iframe detected from a snapshot with an `- iframe:` node", () => {
  const snap = [
    "- document:",
    "  - banner:",
    "  - iframe:",
    "    - button \"Submit\"",
  ].join("\n");
  assert.deepEqual(classes("await page.getByRole('button').click()", "", snap), ["iframe"]);
});

test("popup detected from a Selenium getWindowHandles source token", () => {
  const hits = detectFailureClasses("driver.getWindowHandles();", "", "");
  assert.deepEqual(hits.map((h) => h.cls), ["popup"]);
  assert.match(hits[0]?.hint ?? "", /waitForEvent\('popup'\)/);
});

test("popup detected from a Selenium Python window_handles source token", () => {
  const src = "handles = driver.window_handles";
  assert.deepEqual(classes(src), ["popup"]);
  // set_window_size is a viewport control, not a new-window signal.
  assert.deepEqual(classes("driver.set_window_size(1024, 768)"), []);
});

test("popup detected from a Selenium Python switch_to.window source token", () => {
  assert.deepEqual(classes("driver.switch_to.window(handles[1])"), ["popup"]);
});

test("popup detected from a Cypress invoke('removeAttr','target') source token", () => {
  assert.deepEqual(classes("cy.get('a').invoke('removeAttr', 'target').click()"), ["popup"]);
  // removeAttr('disabled') is an enable-control, not a new-tab workaround.
  assert.deepEqual(classes("cy.get('#btn').invoke('removeAttr', 'disabled')"), []);
});

test("network detected from a Cypress intercept/wait source token", () => {
  const src = "cy.intercept('GET', '/api/users').as('users'); cy.wait('@users')";
  const hits = detectFailureClasses(src, "", "");
  assert.deepEqual(hits.map((h) => h.cls), ["network"]);
  assert.match(hits[0]?.hint ?? "", /page\.route/);
});

test("plain login test yields no false positives (returns [])", () => {
  const src = [
    "cy.visit('/login')",
    "cy.get('#user-name').type('standard_user')",
    "cy.get('#password').type('secret_sauce')",
    "cy.get('#login-button').click()",
    "cy.url().should('include', '/inventory')",
  ].join("\n");
  const snap = "- document:\n  - textbox \"Username\"\n  - button \"Login\"";
  assert.deepEqual(classes(src, "Timeout 30000ms exceeded waiting for getByRole", snap), []);
});

test("multiple classes detected together, in stable order", () => {
  const src = [
    "cy.on('window:confirm', () => true)",
    "cy.iframe('#frame').find('a').click()",
    "cy.stub(win, 'open')",
    "cy.intercept('POST', '/save').as('save')",
  ].join("\n");
  assert.deepEqual(classes(src), ["dialog", "iframe", "popup", "network"]);
});

test("each detected class appears at most once even with redundant signals", () => {
  // iframe signalled by BOTH the source token AND the run-error AND the snapshot.
  const src = "cy.frameLoaded('#f'); cy.iframe('#f')";
  const snap = "- iframe:\n  - button \"Go\"";
  assert.deepEqual(classes(src, "locator resolved to 0 elements", snap), ["iframe"]);
});

test("every detected entry carries a non-empty hint", () => {
  const hits = detectFailureClasses(
    "cy.on('window:confirm', () => true); cy.intercept('GET', '/x')", "", "",
  );
  for (const h of hits) assert.ok(h.hint.length > 0, `empty hint for ${h.cls}`);
});
