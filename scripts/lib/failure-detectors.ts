/**
 * failure-detectors — pure, I/O-free classifier for framework-semantic failure
 * CLASSES the execution-guided repair loop CANNOT self-heal by tweaking locators.
 *
 * Mirrors the `isAuthBootstrapFailure()` pattern in scripts/repair-loop.ts: some
 * failures are not "the locator is slightly wrong" — they are a whole API the
 * migration dropped (dialogs, iframes, popups, network interception). Re-rolling
 * a `getByRole(...)` will never recover them; the repair model needs a TARGETED
 * structural hint instead. Each class can be detected from the SOURCE (the legacy
 * test's tell-tale token), the RUN-ERROR (the live `playwright test` failure), or
 * the SNAPSHOT (Playwright's aria tree), because for some classes only one of the
 * three carries a reliable signal (e.g. Playwright auto-dismisses dialogs, so the
 * run-error is a weak downstream timeout — the SOURCE is the reliable signal).
 */

/** The framework-semantic failure classes this module recognises. */
export type FailureClass = "dialog" | "iframe" | "popup" | "network";

/** A detected failure class plus the concise repair instruction to append. */
export interface DetectedFailure {
  /** The recognised framework-semantic failure class. */
  cls: FailureClass;
  /** A concise instruction to append to the repair prompt for this class. */
  hint: string;
}

/**
 * DIALOGS (alert/confirm/prompt). Playwright AUTO-DISMISSES dialogs unless a
 * `page.on('dialog', …)` handler is registered, so the run-error is only a weak,
 * ambiguous downstream timeout — the RELIABLE signal is the SOURCE token. Covers
 * Cypress `cy.on('window:confirm', …)` / `cy.stub(win, 'confirm')` and Selenium
 * `switchTo().alert()` / `switch_to.alert` / `alertIsPresent`.
 */
const DIALOG_SOURCE =
  /window:(confirm|alert|before:unload)|\.stub\([^)]*(confirm|alert|prompt)|switchTo\(\)\.alert|switch_to\.alert|alertIsPresent/;

/**
 * IFRAMES. Source token covers Cypress (`cy.iframe`, `cy.frameLoaded`,
 * `cypress-iframe`, `.its('0.contentDocument')`) and Selenium frame switching
 * (`switchTo().frame|defaultContent|parentFrame`, `switch_to.frame|…`).
 */
const IFRAME_SOURCE =
  /cy\.iframe\(|cy\.frameLoaded\(|cypress-iframe|\.its\(['"]0\.contentDocument|switchTo\(\)\.(frame|defaultContent|parentFrame)|switch_to\.(frame|default_content|parent_frame)/;

/**
 * IFRAMES — run-error. A locator that lives inside an iframe resolves to nothing
 * at the top level, or strict mode reports more than one match across documents.
 */
const IFRAME_ERROR =
  /locator resolved to 0 elements|resolved to \d+ elements|strict mode violation|more than one element/i;

/**
 * IFRAMES — snapshot. Playwright serializes iframe content nested under an
 * `- iframe:` node, so the target lives under that node rather than top-level.
 */
const IFRAME_SNAPSHOT = /^\s*-\s*iframe:/m;

/**
 * POPUPS / NEW TABS. Source token covers the Cypress workarounds for new windows
 * (`removeAttr('target')`, `cy.invoke('removeAttr', 'target')`, `cy.stub(win,
 * 'open')`, `window:before:load` / `onBeforeLoad`, `cy.origin(`) and Selenium
 * window handling in both Java (`getWindowHandles()`, `switchTo().window(`) and
 * Python (`window_handles`, `switch_to.window(`). Controls like `set_window_size`
 * and `removeAttr('disabled')` deliberately do NOT match.
 */
const POPUP_SOURCE =
  /removeAttr\(['"]?\s*,?\s*['"]target|invoke\(\s*['"]removeAttr['"]\s*,\s*['"]target|cy\.stub\([^)]*,\s*['"]open['"]|window:before:load|onBeforeLoad|cy\.origin\(|getWindowHandles\(|switchTo\(\)\.window\(|window_handles|switch_to\.window\(/;

/**
 * NETWORK INTERCEPTION. Source token covers Cypress route interception / aliasing
 * (`cy.intercept(`, `cy.wait('@…')`, `req.reply(`, `.its('response.…')`). A
 * dedicated hard-gate validator handles this elsewhere — here we only emit a hint.
 */
const NETWORK_SOURCE =
  /cy\.intercept\(|cy\.wait\(['"]@|req\.reply\(|\.its\(['"]response\./;

const DIALOG_HINT =
  "## DIALOG handling (alert/confirm/prompt) — Playwright auto-dismisses, so register a handler BEFORE the triggering action. " +
  "Add `page.on('dialog', d => d.accept())` to accept (mirrors Cypress's default / Selenium `.accept()` / a `confirm` stub returning true) " +
  "or `d.dismiss()` to cancel (mirrors `.dismiss()` / a stub returning false). For a prompt, supply input via `d.accept(text)`. " +
  "Use `page.once('dialog', …)` when only a single dialog fires. The source proves a dialog is expected even though the run-error looks like a plain timeout.";

const IFRAME_HINT =
  "## IFRAME scoping — the target element lives inside an iframe, so a top-level locator resolves to 0 elements. " +
  "Scope it: `page.frameLocator('<iframe-selector>').getByRole(...)` or `page.locator('<iframe>').contentFrame().getByRole(...)`. " +
  "Playwright frame scoping is PER-CALL, not stateful: drop any `defaultContent()` / `parentFrame()` switch-back — just re-scope each locator through the frame.";

const POPUP_HINT =
  "## POPUP / NEW TAB — the action opens a new page, so subsequent locators time out on the ORIGINAL page. " +
  "Capture the popup: `const [popup] = await Promise.all([page.waitForEvent('popup'), <the click>]); await popup.waitForLoadState();` " +
  "then run the later assertions against `popup`. For a `target=_blank` link use `context.waitForEvent('page')` instead of `page.waitForEvent('popup')`.";

const NETWORK_HINT =
  "## NETWORK interception — the source stubbed or asserted on a network call the migration likely dropped. " +
  "Recreate the stub BEFORE the triggering action: `await page.route('**/<url>', r => r.fulfill({ status, body }))`. " +
  "Where the source asserted on the response, await it: `const resp = await page.waitForResponse('**/<url>'); expect(resp.status()).toBe(...)`.";

/**
 * Detect framework-semantic failure CLASSES that the locator-tweaking repair loop
 * cannot self-heal, returning one targeted repair hint per detected class.
 *
 * A class is reported if ANY of its three evidence sources fires: the SOURCE
 * (the legacy test's tell-tale token), the run-ERROR (the live `playwright test`
 * failure tail), or the SNAPSHOT (Playwright's aria tree — used only for iframes,
 * whose content nests under an `- iframe:` node). Each class is reported at most
 * once, in a stable order (dialog, iframe, popup, network).
 *
 * @param source - The original legacy test (bad-Playwright / Cypress / Selenium).
 * @param failureTail - The tail of the live `playwright test` execution error.
 * @param snapshot - Playwright's accessibility-tree snapshot of the failing page.
 * @returns One `{ cls, hint }` entry per detected class; `[]` when none match.
 */
export function detectFailureClasses(
  source: string,
  failureTail: string,
  snapshot: string,
): DetectedFailure[] {
  const detected: DetectedFailure[] = [];

  // DIALOGS: the source is the reliable signal (PW auto-dismisses → weak error).
  if (DIALOG_SOURCE.test(source)) {
    detected.push({ cls: "dialog", hint: DIALOG_HINT });
  }

  // IFRAMES: source token OR a "0 elements"/strict-mode run-error OR an
  // `- iframe:` node in the snapshot (target nested under the iframe).
  if (
    IFRAME_SOURCE.test(source) ||
    IFRAME_ERROR.test(failureTail) ||
    IFRAME_SNAPSHOT.test(snapshot)
  ) {
    detected.push({ cls: "iframe", hint: IFRAME_HINT });
  }

  // POPUPS / NEW TABS: source token (the run-error is an ambiguous timeout).
  if (POPUP_SOURCE.test(source)) {
    detected.push({ cls: "popup", hint: POPUP_HINT });
  }

  // NETWORK interception: source token (hard-gate validator lives elsewhere).
  if (NETWORK_SOURCE.test(source)) {
    detected.push({ cls: "network", hint: NETWORK_HINT });
  }

  return detected;
}
