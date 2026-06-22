#!/usr/bin/env tsx
/**
 * Unit tests for the OFFLINE ABSTENTION GATE in validate-plan-dom-grounding.ts
 * (lever 1). With no DOM snapshot, a HIGH-confidence pin whose accessible name
 * is not derivable from the source is a confident hallucination and must fail;
 * low/medium pins, structural fallbacks, defense pins, and source-derivable
 * names must pass. The snapshot-present grounding path is exercised elsewhere
 * (calibration corpus); these tests pin the no-snapshot behavior the gate adds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./validate-plan-dom-grounding.ts", import.meta.url));

/** Build a minimal plan with one Locator-translation row + optional defense pin. */
function planWith(row: string, defensePins = ""): string {
  return [
    "# Migration plan",
    "",
    "## Locator translation table",
    "",
    "| Original | New | Confidence | Notes |",
    "|---|---|---|---|",
    row,
    "",
    defensePins ? "## Hallucination-defense pins\n\n" + defensePins + "\n" : "",
  ].join("\n");
}

interface RunResult {
  code: number;
  stderr: string;
  stdout: string;
}

/** Write the plan (and optional source) to a temp dir and run the gate offline. */
function runOffline(planMd: string, sourceText?: string): RunResult {
  const dir = mkdtempSync(join(tmpdir(), "pdg-"));
  try {
    const planPath = join(dir, "case.md");
    writeFileSync(planPath, planMd);
    // No --snapshot: the derived (absent) default sends us down the offline branch.
    const args = [SCRIPT, "--plan", planPath];
    if (sourceText !== undefined) {
      const srcPath = join(dir, "input.spec.ts");
      writeFileSync(srcPath, sourceText);
      args.push("--source", srcPath);
    }
    const r = spawnSync("npx", ["tsx", ...args], { encoding: "utf8" });
    return { code: r.status ?? -1, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("offline gate FAILS a high-confidence pin whose name is absent from source (confident hallucination)", () => {
  const plan = planWith(
    "| `page.locator('.greeting')` | `page.getByRole('heading', { name: 'Welcome back, Jane' })` | high | greeting |",
  );
  const r = runOffline(plan, "await page.locator('.greeting').click(); // login flow, no welcome text");
  assert.equal(r.code, 1, "a high-confidence ungrounded canonical name must exit 1");
  assert.match(r.stderr, /confident hallucination/);
});

test("offline gate PASSES when the name IS derivable from source", () => {
  const plan = planWith(
    "| `page.getByText('Sign in')` | `page.getByRole('button', { name: 'Sign in' })` | high | submit |",
  );
  const r = runOffline(plan, "await page.getByText('Sign in').click();");
  assert.equal(r.code, 0, "a name present in the source is an honest translation, not a hallucination");
});

test("offline gate PASSES a low-confidence ungrounded guess (honest abstention)", () => {
  const plan = planWith(
    "| `page.locator('.greeting')` | `page.getByRole('heading', { name: /welcome back/i })` | low | greeting MAY be a heading |",
  );
  const r = runOffline(plan, "await page.locator('.greeting').click();");
  assert.equal(r.code, 0, "low confidence already flags the guess — the gate leaves it alone");
});

test("offline gate PASSES a structural CSS fallback (pins no accessible name)", () => {
  const plan = planWith(
    "| `page.locator('.greeting')` | `page.locator('.greeting')` | high | keep CSS, element type unknown |",
  );
  const r = runOffline(plan, "await page.locator('.greeting').click();");
  assert.equal(r.code, 0, "a CSS locator pins no name — it is the honest offline fallback");
});

test("offline gate PASSES a name that lives only in the hallucination-defense section", () => {
  const plan = planWith(
    "| `page.locator('.greeting')` | `page.locator('.greeting')` | high | see pins |",
    "1. **Greeting** — assumed `getByRole('heading', { name: /welcome back/i })`. If DOM lacks heading: keep CSS.",
  );
  const r = runOffline(plan, "await page.locator('.greeting').click();");
  assert.equal(r.code, 0, "defense-section guesses are the escape hatch — never failed by the gate");
});

test("offline gate PASSES Username vs source id user-name (squash match)", () => {
  const plan = planWith(
    "| `page.locator('#user-name')` | `page.getByLabel('Username')` | high | label assumed |",
  );
  const r = runOffline(plan, "driver.find_element(By.ID, 'user-name')");
  assert.equal(r.code, 0, "user-name → username after separator-squash is derivable, not a hallucination");
});

test("offline gate runs with NO --source using the plan's own Original column as corpus", () => {
  // Original cell carries `getByText('Add to cart')`; New name 'Add to cart' is derivable from it.
  const plan = planWith(
    "| `page.getByText('Add to cart')` | `page.getByRole('button', { name: 'Add to cart' })` | high | submit |",
  );
  const r = runOffline(plan); // no source file
  assert.equal(r.code, 0, "the Original column is source-grounded vocabulary — degraded gate still passes it");
});
