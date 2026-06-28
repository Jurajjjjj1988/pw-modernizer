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
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
 * Every Stage-2 spec carries a provenance header: `// See outputs/plans/<input>.md`.
 * That uniquely ties a spec to the migration that produced it, independent of the
 * filename the LLM chose. Matching on it is what lets us resolve a spec the model
 * free-named (e.g. `internet-login.spec.ts` for input `github-internet-login.cy.js`).
 */
function matchesProvenance(specPath: string, inputBasename: string): boolean {
  try {
    return readFileSync(specPath, "utf8").slice(0, 400).includes(`outputs/plans/${inputBasename}.md`);
  } catch {
    return false;
  }
}

/**
 * The spec generated for `inputBasename`. Resolution order:
 *  1. exact kebab-basename match (the common case);
 *  2. provenance-header match — the spec whose header cites THIS input's plan
 *     (robust to the LLM free-naming the spec file);
 *  3. a single-spec tree (unambiguous);
 *  4. otherwise null — REFUSE to guess. Returning the lexically-first spec (the
 *     old behaviour) made the repair loop pick + overwrite an unrelated committed
 *     example (force-clicks.spec.ts) and report a misattributed green. Callers all
 *     handle null safely; a wrong-file guess corrupts state silently.
 */
export function findGeneratedSpec(outDir: string, inputBasename: string): string | null {
  const specs = listOutputSpecs(outDir);
  if (specs.length === 0) return null;
  const expected = new Set(expectedSpecBasenames(inputBasename));
  const byName = specs.find((s) => expected.has(basename(s)));
  if (byName) return byName;
  const byProvenance = specs.filter((s) => matchesProvenance(s, inputBasename));
  if (byProvenance.length >= 1) return byProvenance.sort((a, b) => a.length - b.length)[0] ?? null;
  if (specs.length === 1) return specs[0] ?? null;
  return null;
}
