/**
 * output-spec.ts — the ONE basename-scoped resolver for "which Stage-2 spec was
 * generated for THIS input".
 *
 * CI used to pick the spec to score/diff with `find outputs/tests … | head -1`,
 * which always returns the lexically-first spec — so on a flat outputs/tests/
 * holding every merged migration, confidence + AST-diff + the report's
 * Source→Output header were all computed against a FIXED, unrelated file
 * (force-clicks.spec.ts), not the migration under review. `migrate-local.ts`
 * already resolved correctly by input basename; this module lifts that logic
 * into one place so CI and local share it (and can never diverge again).
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Kebab spec basenames Stage 2 may emit for an input (kebab + optional trailing
 * `-test` drop + leading `test-` drop) — mirrors the conformance / report-metrics
 * derivation, and handles cross-language renames (e.g. `EmployeesTest.java` →
 * `employees.spec.ts`).
 */
export function expectedSpecBasenames(inputBasename: string): string[] {
  const stem = inputBasename.replace(/\.(java|py|cy\.[jt]s|spec\.[jt]s|[jt]s)$/i, "");
  const kebab = stem.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replaceAll("_", "-").toLowerCase();
  const out = new Set<string>([`${kebab}.spec.ts`]);
  const dropTrailing = kebab.replace(/-tests?$/, "");
  if (dropTrailing !== kebab) out.add(`${dropTrailing}.spec.ts`);
  const dropLeading = kebab.replace(/^test-/, "");
  if (dropLeading !== kebab) out.add(`${dropLeading}.spec.ts`);
  return [...out];
}

/** All *.spec.ts under `outDir` (excluding the v0.1.x archive), lexically sorted. */
export function listOutputSpecs(outDir: string): string[] {
  if (!existsSync(outDir)) return [];
  const out: string[] = [];
  const stack = [outDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_legacy-v0.1.x") stack.push(full);
      } else if (entry.name.endsWith(".spec.ts")) {
        out.push(full);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * The spec generated for `inputBasename`, scoped by basename. Falls back to the
 * lexically-first spec ONLY when no basename match exists (so a single-spec tree
 * still resolves, and an unexpected Stage-2 name degrades gracefully rather than
 * erroring). Returns null only when the tree has no specs at all.
 */
export function findGeneratedSpec(outDir: string, inputBasename: string): string | null {
  const specs = listOutputSpecs(outDir);
  if (specs.length === 0) return null;
  const expected = new Set(expectedSpecBasenames(inputBasename));
  return specs.find((s) => expected.has(basename(s))) ?? specs[0] ?? null;
}
