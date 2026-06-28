#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRepairPrompt, extractPageSnapshot, findFailureSnapshot } from "./repair-loop.js";

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
