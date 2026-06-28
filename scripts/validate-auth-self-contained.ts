#!/usr/bin/env tsx
/**
 * validate-auth-self-contained.ts — fail a migration whose authentication is not
 * self-contained (the durable prevent-layer to the repair loop's IMP9 cure).
 *
 * Validating the closed loop on a real GitHub test exposed a defect the static
 * gates all missed: the migration emitted an `authenticated.fixture` with
 *   storageState: "playwright/.auth/saucedemo.json"
 * but NOTHING in the pipeline creates that file, so every test dies at setup
 * (ENOENT) before a page ever loads — yet it COMPILES and passes every static
 * gate. Playwright's own auth pattern is explicit: a `storageState` FILE is
 * produced by a setup project (`auth.setup.ts` that calls
 * `context.storageState({ path })`) declared as a `dependencies` of the test
 * project. So the rule is deterministic: if the emitted tree references a
 * storageState file path, the tree MUST also contain a producer that writes it;
 * otherwise the migration can never run green and we reject it up front (zero
 * tokens) instead of discovering it only at the execution gate.
 *
 *   npx tsx scripts/validate-auth-self-contained.ts --root outputs --input-basename foo.cy.js
 *
 * Pure core (storageStateRefs / hasStorageStateProducer / authVerdict) is unit-tested.
 * Exit 0 = self-contained (or no storageState used); 1 = dangling storageState.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { collectEmittedFiles } from "./evaluate.js";
import { findGeneratedSpec } from "./output-spec.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

/**
 * Extract storageState FILE-PATH references from one source. We catch both the
 * direct config form (`storageState: 'x.json'`) and the fixture form
 * (`storageState: async ({}, use) => use('x.json')`). An INLINE object
 * (`storageState: { cookies: [...] }`) is self-contained and is NOT a file ref.
 */
export function storageStateRefs(src: string): string[] {
  const refs: string[] = [];
  const re = /storageState\b[\s\S]{0,80}?/g; // anchor on each storageState mention
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    // From the match start, look ahead for the FIRST quoted *.json literal on the
    // same statement (before a newline-of-a-new-statement). The 120-char window
    // covers `async ({}, use) => use("…")`.
    const window = src.slice(m.index, m.index + 120);
    const path = /['"`]([^'"`]+\.json)['"`]/.exec(window);
    if (path?.[1]) refs.push(path[1]);
  }
  return [...new Set(refs)];
}

/** Does any source in the tree PRODUCE a storageState file (a setup writer)? */
export function hasStorageStateProducer(sources: string[]): boolean {
  // `context.storageState({ path: '…' })` / `page.context().storageState({ path })`
  // is the canonical save call an auth.setup makes.
  return sources.some((s) => /\.storageState\(\s*\{[^})]*\bpath\b/.test(s));
}

export interface AuthVerdict { selfContained: boolean; refs: string[]; hasProducer: boolean; reason: string }

/** A migration is auth-self-contained when it references no storageState file,
 * or it does AND the tree also contains a producer that writes that file. */
export function authVerdict(sources: string[]): AuthVerdict {
  const refs = [...new Set(sources.flatMap(storageStateRefs))];
  if (refs.length === 0) return { selfContained: true, refs, hasProducer: false, reason: "no storageState file referenced (inline auth)" };
  const hasProducer = hasStorageStateProducer(sources);
  return {
    selfContained: hasProducer,
    refs,
    hasProducer,
    reason: hasProducer
      ? `storageState ${refs.join(", ")} is produced by a setup writer in the tree`
      : `storageState ${refs.join(", ")} is referenced but NOTHING in the migrated tree creates it — the test will die at setup (ENOENT). Use an inline login (beforeEach) or generate an auth.setup that writes it.`,
  };
}

function main(): number {
  const { values } = parseArgs({
    options: { root: { type: "string", default: "outputs" }, "input-basename": { type: "string" } },
    strict: true,
  });
  const base = values["input-basename"];
  if (!base) { process.stderr.write("validate-auth-self-contained: --input-basename <base> required.\n"); return 1; }
  const outDir = resolve(REPO_ROOT, values.root ?? "outputs", "tests");
  const spec = findGeneratedSpec(outDir, base);
  if (!spec) { process.stderr.write(`validate-auth-self-contained: no spec for ${base} under ${relative(REPO_ROOT, outDir)}.\n`); return 1; }
  const files = collectEmittedFiles(spec).filter(existsSync);
  const sources = files.map((f) => readFileSync(f, "utf8"));
  const v = authVerdict(sources);
  if (v.selfContained) {
    process.stdout.write(`auth self-contained ✓ — ${v.reason} (${files.length} files).\n`);
    return 0;
  }
  process.stderr.write(`auth NOT self-contained ✗ — ${v.reason}\n`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
