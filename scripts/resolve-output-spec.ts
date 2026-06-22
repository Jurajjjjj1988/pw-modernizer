#!/usr/bin/env tsx
/**
 * resolve-output-spec.ts — print the Stage-2 spec generated for a given input,
 * scoped by input basename. Replaces CI's `find outputs/tests … | head -1`,
 * which always returned the lexically-first spec (so confidence + AST-diff +
 * the report header described a FIXED unrelated file, not the migration under
 * review). Wired into migrate.yml's evaluate + ast-diff steps.
 *
 *   npx tsx scripts/resolve-output-spec.ts --input-basename <base> [--root outputs/tests]
 *
 * Exit codes: 0 = path printed; 1 = no spec found under root; 2 = usage error.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { findGeneratedSpec } from "./output-spec.js";

const { values } = parseArgs({
  options: {
    "input-basename": { type: "string" },
    root: { type: "string", default: "outputs/tests" },
  },
  strict: true,
});

const base = values["input-basename"];
if (!base) {
  process.stderr.write("Usage: resolve-output-spec --input-basename <base> [--root <dir>]\n");
  process.exit(2);
}

const outDir = resolve(process.cwd(), values.root ?? "outputs/tests");
const spec = findGeneratedSpec(outDir, base);
if (!spec) {
  process.stderr.write(`resolve-output-spec: no *.spec.ts found under ${outDir} for input '${base}'\n`);
  process.exit(1);
}
process.stdout.write(`${spec}\n`);
