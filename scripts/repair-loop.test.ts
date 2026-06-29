#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRepairPrompt, extractPageSnapshot, findFailureSnapshot, isAuthBootstrapFailure, buildLintRepairPrompt, buildAssertionRestorePrompt } from "./repair-loop.js";

test("repair prompt carries the execution error, the live snapshot, the file list, and the getByLabel hint", () => {
  const p = buildRepairPrompt(
    "/r/outputs/tests/x.spec.ts",
    ["/r/outputs/tests/x.spec.ts", "/r/outputs/helper/page-object/pages/login.page.ts"],
    "waiting for getByLabel(/username/i)\nelement(s) not found",
    '- textbox "Username"\n- button "Login"',
    "https://www.saucedemo.com",
  );
  assert.match(p, /FAILS when run against the real app/);
  assert.match(p, /getByLabel\(\/username\/i\)/);          // the failure
  assert.match(p, /textbox "Username"/);                    // the live snapshot
  assert.match(p, /login\.page\.ts/);                        // the file in scope
  assert.match(p, /getByPlaceholder\(name\)/);               // the placeholder-not-label hint
  assert.match(p, /Do NOT weaken assertions/);               // anti-cheat guard
});

// ---- IMP8: failure-time page snapshot (the exact page the broken locator hit).

test("buildRepairPrompt: atFailure switches the snapshot header to the authoritative wording", () => {
  const files: string[] = [];
  const blind = buildRepairPrompt("/r/outputs/tests/x.spec.ts", files, "err", "- text: Products", "https://app", false);
  const atFail = buildRepairPrompt("/r/outputs/tests/x.spec.ts", files, "err", "- text: Products", "https://app", true);
  assert.match(blind, /accessibility tree RIGHT NOW/);
  assert.ok(!/AT THE MOMENT OF FAILURE/.test(blind), "blind snapshot must not claim failure-time authority");
  assert.match(atFail, /AT THE MOMENT OF FAILURE/);
  assert.match(atFail, /authoritative/);
});

test("extractPageSnapshot: pulls the fenced yaml page-snapshot body out of error-context.md", () => {
  const md = [
    "# Test info", "- Name: x", "", "# Error details", "```", "Error: not found", "```",
    "", "```yaml", '- button "Open Menu"', "- text: Swag Labs Products", "```", "",
  ].join("\n");
  const snap = extractPageSnapshot(md);
  assert.match(snap, /button "Open Menu"/);
  assert.match(snap, /Swag Labs Products/);
  assert.ok(!snap.includes("Error: not found"), "must not bleed the error block into the snapshot");
  assert.ok(!snap.includes("```"), "fences are stripped");
});

test("extractPageSnapshot: returns '' when the context file has no yaml snapshot", () => {
  assert.equal(extractPageSnapshot("# Error details\n```\njust a stack\n```\n"), "");
});

test("findFailureSnapshot: matches the newest error-context.md for the spec stem, ignores other specs", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-failsnap-"));
  try {
    const tr = join(root, "test-results");
    // The spec under repair + an unrelated spec's results in the same dir.
    const mine = join(tr, "github-saucedemo-cart-SAUC-1-add-chromium");
    const other = join(tr, "some-other-spec-FOO-chromium");
    mkdirSync(mine, { recursive: true });
    mkdirSync(other, { recursive: true });
    writeFileSync(join(mine, "error-context.md"), '```yaml\n- text: Products\n```\n');
    writeFileSync(join(other, "error-context.md"), '```yaml\n- text: WRONG PAGE\n```\n');
    const snap = findFailureSnapshot("github-saucedemo-cart", tr);
    assert.match(snap, /text: Products/);
    assert.ok(!snap.includes("WRONG PAGE"), "must not pick another spec's failure context");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findFailureSnapshot: returns '' when no result dir matches (caller falls back to base-URL snap)", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-failsnap-none-"));
  try {
    assert.equal(findFailureSnapshot("github-saucedemo-cart", join(root, "test-results")), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- IMP9: source-in-prompt + auth-bootstrap (storageState the pipeline never makes).

test("isAuthBootstrapFailure: detects the storageState/ENOENT auth-setup class, ignores plain locator misses", () => {
  assert.ok(isAuthBootstrapFailure("Error reading storage state from playwright/.auth/saucedemo.json: ENOENT"));
  assert.ok(isAuthBootstrapFailure("ENOENT: no such file or directory, open 'playwright/.auth/x.json'"));
  assert.ok(isAuthBootstrapFailure("storageState: 'auth.json' could not be read"));
  assert.ok(!isAuthBootstrapFailure("waiting for getByRole('heading', { name: /products/i })"));
  assert.ok(!isAuthBootstrapFailure("expect(locator).toBeVisible() failed: element(s) not found"));
});

test("buildRepairPrompt: includes the SOURCE test block when a source is given", () => {
  const p = buildRepairPrompt("/r/x.spec.ts", [], "waiting for getByLabel(/u/i)", "- text: x", "https://app", false,
    "describe('Add Cart', () => { beforeEach(() => { cy.visit('/'); cy.get('[data-test=\"username\"]').type('u'); }); });");
  assert.match(p, /SOURCE test \(the INTENT reference/);
  assert.match(p, /data-test="username"/, "the real source login steps are shown to the repair model");
});

test("buildRepairPrompt: an auth-bootstrap failure adds the self-contained-auth directive (inline login)", () => {
  const p = buildRepairPrompt("/r/x.spec.ts", [], "Error reading storage state from playwright/.auth/x.json: ENOENT",
    "- text: x", "https://app", false, "cy.get('[data-test=\"username\"]')");
  assert.match(p, /authentication is NOT self-contained/i);
  assert.match(p, /perform the login INLINE in a/);
  assert.match(p, /standard_user/, "gives an unattended-run credential fallback");
});

test("buildRepairPrompt: a plain locator failure does NOT add the auth directive", () => {
  const p = buildRepairPrompt("/r/x.spec.ts", [], "waiting for getByRole('heading', { name: /products/i })",
    "- text: Products", "https://app", true);
  assert.ok(!/authentication is NOT self-contained/i.test(p), "locator failures must not trigger the auth block");
});

// ---- IMP5: lint-repair (green AND lint-clean).

test("buildAssertionRestorePrompt: lists the weakenings + forbids weaker matchers / dropped asserts (B1)", () => {
  const p = buildAssertionRestorePrompt(
    ["/r/outputs/tests/x.spec.ts"],
    [{ kind: "strength-drop", detail: "total assertion strength 4 → 1 (a matcher was weakened, e.g. toHaveText→toBeVisible)" }],
  );
  assert.match(p, /WEAKENING its assertions/);
  assert.match(p, /a matcher was weakened/);             // the specific violation
  assert.match(p, /fix the LOCATOR\/target instead/);    // fix the real cause
  assert.match(p, /Never substitute a weaker matcher/);  // the guard
});

test("buildLintRepairPrompt: carries the eslint output + files and forbids behaviour changes / disable-comments", () => {
  const p = buildLintRepairPrompt(
    ["/r/outputs/tests/x.spec.ts", "/r/outputs/helper/page-object/pages/login.page.ts"],
    "x.spec.ts\n  4:16  error  'expect' is defined but never used  @typescript-eslint/no-unused-vars",
  );
  assert.match(p, /RUNS GREEN against the live app, but it FAILS the lint gate/);
  assert.match(p, /'expect' is defined but never used/); // the real eslint signal
  assert.match(p, /login\.page\.ts/);                      // file in scope
  assert.match(p, /keep it green/);                        // don't change behaviour
  assert.match(p, /Do NOT add eslint-disable/);            // no silencing
});
