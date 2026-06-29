#!/usr/bin/env tsx
/**
 * cypress-codemod.ts — deterministic Cypress→Playwright transforms (BP6).
 *
 * Prior art (OpenRewrite, cy2pw which is pure Babel-AST): the MECHANICAL part of
 * a migration (API renames, await insertion, test()-wrapping, hard-wait removal)
 * is a deterministic, idempotent transform — it should be a codemod, NOT an LLM
 * prompt. Doing it deterministically removes a whole class of LLM-variability
 * bugs and shrinks what the model must reason about to the genuinely semantic
 * ~20% (selector strategy, wait→assertion intent), which still goes to Claude.
 *
 * This is a line/expression-level codemod for the UNAMBIGUOUS Cypress patterns.
 * It deliberately does NOT touch chained `.should().should()`, `.then()`
 * closures, `.each()/.filter()`, or aliases — those are not deterministic and
 * are left for the LLM (the codemod's output is a DRAFT the model refines).
 * Every transform is idempotent (re-running makes no further change), which the
 * fixture tests assert.
 *
 *   npx tsx scripts/cypress-codemod.ts --input foo.cy.js [--out foo.draft.spec.ts]
 *
 * Exit 0 always (a best-effort pre-pass). Pure transformCypress is unit-tested.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * Marker prepended above a `cy.get(...).type('…{enter}…')` left for the LLM.
 * A Cypress key-sequence inside `.type()` is NOT a plain fill — `{enter}`,
 * `{selectall}`, … are keyboard directives Cypress interprets, so a literal
 * `.fill('foo{enter}')` would type the braces verbatim. The semantic lowering
 * (pressSequentially + press('Enter')) is the LLM's job; the codemod just flags it.
 */
export const KEY_SEQUENCE_MARKER =
  "// CODEMOD: Cypress key-sequence — translate to keyboard press (e.g. pressSequentially + press('Enter'))";

/** Cypress key-sequence tokens that make `.type()` a keyboard directive, not a plain fill. */
const KEY_SEQUENCE_RE = /\{(enter|selectall|esc|backspace|del|tab|home|end)\}/;
/** `cy.get('X').type('…')` (single string arg) — used to detect the key-sequence special-case. */
const GET_TYPE_RE =
  /(?<!await\s)cy\.get\(\s*(['"`][^'"`]*['"`])\s*\)\.type\(\s*(['"`][^'"`]*['"`])\s*\)/g;
/** Restore token for a shielded key-sequence `.type()` (no source/transform regex matches it). */
const keySeqToken = (i: number): string => `__PWM_KEYSEQ_${i}__`;

/** Apply the deterministic Cypress→Playwright transforms to one source string. */
export function transformCypress(src: string): string {
  let out = src;

  // SPECIAL-CASE (before the .type→fill / bare cy.get rewrites): a key-sequence
  // .type() is left UNtransformed + marked. We swap each occurrence for a unique
  // placeholder so NO subsequent regex (incl. the bare cy.get rewrite) touches it,
  // then restore it below with the marker prepended once. Leaving cy.* in place
  // restores cyCallsLeft visibility (the LLM tail still sees the call).
  const keySeqSlots: string[] = [];
  out = out.replace(GET_TYPE_RE, (match, _sel: string, arg: string) => {
    if (!KEY_SEQUENCE_RE.test(arg)) return match;
    const token = keySeqToken(keySeqSlots.length);
    keySeqSlots.push(match);
    return token;
  });

  // cy.visit('X') / cy.visit("X")  →  await page.goto('X')   (idempotent: skip if already page.goto)
  out = out.replace(/(?<!await\s)cy\.visit\(\s*(['"`][^'"`]*['"`])\s*\)/g, "await page.goto($1)");

  // cy.wait(1000) — a NUMERIC hard wait → removed (the line, with its indent). cy.wait('@alias') is
  // a network sync and is LEFT for the LLM (it lowers to waitForResponse, not a delete).
  out = out.replace(/^[ \t]*cy\.wait\(\s*\d+\s*\)\s*;?[ \t]*\r?\n/gm, "");

  // cy.get('X').click()  →  await page.locator('X').click()
  out = out.replace(/(?<!await\s)cy\.get\(\s*(['"`][^'"`]*['"`])\s*\)\.click\(\)/g, "await page.locator($1).click()");
  // cy.get('X').type('Y')  →  await page.locator('X').fill('Y')
  out = out.replace(/(?<!await\s)cy\.get\(\s*(['"`][^'"`]*['"`])\s*\)\.type\(\s*(['"`][^'"`]*['"`])\s*\)/g, "await page.locator($1).fill($2)");
  // Bare cy.get('X')  →  page.locator('X')  (after the chained forms above)
  out = out.replace(/cy\.get\(\s*(['"`][^'"`]*['"`])\s*\)/g, "page.locator($1)");
  // cy.contains('X')  →  page.getByText('X')
  out = out.replace(/cy\.contains\(\s*(['"`][^'"`]*['"`])\s*\)/g, "page.getByText($1)");

  // it('X', () => {  →  test('X', async ({ page }) => {   (and .only/.skip). The
  // `(?<!\.)` keeps a second pass from matching `.it`/`.describe` (idempotency).
  out = out.replace(/(?<!\.)\bit(\.only|\.skip)?\(\s*(['"`][^'"`]*['"`])\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{/g,
    (_m, mod: string, name: string) => `test${mod ?? ""}(${name}, async ({ page }) => {`);
  // describe('X', () => {  →  test.describe('X', () => {
  out = out.replace(/(?<!\.)\bdescribe(\.only|\.skip)?\(\s*(['"`][^'"`]*['"`])\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{/g,
    (_m, mod: string, name: string) => `test.describe${mod ?? ""}(${name}, () => {`);

  // Restore each shielded key-sequence .type() call line-by-line, prepending the
  // marker on its own line above (indented to match). Idempotent: a re-run re-shields
  // the same expression, so we add the marker only when the previous OUTPUT line is
  // not already the marker — a second pass therefore yields byte-identical output.
  if (keySeqSlots.length > 0) {
    out = restoreKeySequences(out, keySeqSlots);
  }

  return out;
}

/** Swap each `keySeqToken(i)` back to its original `cy.get(...).type(...)`, marker prepended once. */
function restoreKeySequences(out: string, slots: readonly string[]): string {
  const lines = out.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    let restored = line;
    for (const [i, original] of slots.entries()) {
      // Function replacement returns the original verbatim (no `$&`/`$1` interpretation).
      restored = restored.replace(keySeqToken(i), () => original);
    }
    if (restored !== line) {
      const indent = /^[ \t]*/.exec(restored)?.[0] ?? "";
      const prev = result.at(-1);
      if (prev?.trim() !== KEY_SEQUENCE_MARKER) result.push(`${indent}${KEY_SEQUENCE_MARKER}`);
    }
    result.push(restored);
  }
  return result.join("\n");
}

/** Stats on what the codemod handled deterministically (for reporting). */
export function codemodStats(before: string, after: string): { hardWaitsRemoved: number; cyCallsLeft: number; transformed: boolean } {
  return {
    hardWaitsRemoved: (before.match(/cy\.wait\(\s*\d+\s*\)/g) ?? []).length,
    cyCallsLeft: (after.match(/\bcy\./g) ?? []).length,
    transformed: before !== after,
  };
}

function main(): number {
  const { values } = parseArgs({ options: { input: { type: "string" }, out: { type: "string" } }, strict: true });
  if (!values.input) { process.stderr.write("cypress-codemod: --input <foo.cy.js> required.\n"); return 1; }
  const before = readFileSync(values.input, "utf8");
  const after = transformCypress(before);
  const s = codemodStats(before, after);
  if (values.out) writeFileSync(values.out, after);
  else process.stdout.write(after);
  process.stderr.write(
    `cypress-codemod: ${s.hardWaitsRemoved} hard wait(s) removed; ${s.cyCallsLeft} cy.* call(s) left for the LLM ` +
      `(chains/closures/aliases — the semantic ~20%).\n`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
