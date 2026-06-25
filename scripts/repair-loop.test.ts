#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRepairPrompt } from "./repair-loop.js";

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
