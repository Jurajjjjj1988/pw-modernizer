#!/usr/bin/env tsx
/**
 * validate-helper-usage.ts — post-Stage-2 gate that flags exported helpers
 * under `outputs/helper/api/**` that aren't referenced anywhere else under
 * `outputs/`.
 *
 * Background: PR #126 verify SDET (2026-06-16, cypress wishlist) flagged a
 * real bug where Stage 2 emitted `clearWishlist` in
 * `outputs/helper/api/wishlist.api.ts` (intended as teardown) but never
 * imported/called it in `outputs/tests/wishlist.spec.ts` — so the test
 * accumulated state across runs. The validator wall (typecheck, eslint,
 * conformance) didn't catch it because the export was syntactically valid
 * and the spec was independently valid. The bug only showed up in the
 * CANDOR review because a human-like reader noticed the teardown name and
 * looked for its consumer.
 *
 * This script is the defense-in-depth automatic check. Scope is limited to
 * `outputs/helper/api/**` because API helpers are pure functions with no
 * DI/fixture indirection — if they're not imported by name they're dead.
 * `actions/` and `utilities/` may legitimately be re-exported through the
 * fixture barrel, so they're excluded from this first pass.
 *
 * Checks (all warn-severity by default; --strict promotes to block):
 *   1. Every exported function from `outputs/helper/api/*.ts` must appear
 *      by name in at least one OTHER file under `outputs/` (spec, fixture,
 *      page, action — anywhere that isn't its own declaration file).
 *
 * CLI:
 *   npx tsx scripts/validate-helper-usage.ts          # warn mode
 *   npx tsx scripts/validate-helper-usage.ts --strict # block mode
 *
 * Exit codes:
 *   0 = clean (no unused exports)
 *   1 = unused exports found AND --strict was passed; warn-only otherwise
 *
 * Strict TS, no any.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { Project, SyntaxKind } from "ts-morph";

function walkTs(root: string, predicate: (p: string) => boolean = () => true): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (s.isFile() && full.endsWith(".ts") && predicate(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

interface UnusedExport {
  readonly file: string;
  readonly name: string;
}

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_API_DIR = join(REPO_ROOT, "outputs/helper/api");
const DEFAULT_CONSUMER_ROOT = join(REPO_ROOT, "outputs");

function parseCliFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

/**
 * Extract all top-level exported function names from a TypeScript file.
 * Excludes default exports (no canonical name to reference) and re-exports
 * (those are followed transitively when the consumer scan resolves them).
 */
function extractExportedFunctionNames(filePath: string): readonly string[] {
  const project = new Project({
    useInMemoryFileSystem: false,
    compilerOptions: { allowJs: false },
  });
  const sourceFile = project.addSourceFileAtPath(filePath);
  const names: string[] = [];
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isExported() && !fn.isDefaultExport()) {
      const name = fn.getName();
      if (name) names.push(name);
    }
  }
  // Cover `export const foo = ...` and `export const foo = async (...) => ...`
  for (const decl of sourceFile.getVariableDeclarations()) {
    const stmt = decl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
    if (!stmt?.isExported()) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    if (
      init.getKind() === SyntaxKind.ArrowFunction ||
      init.getKind() === SyntaxKind.FunctionExpression
    ) {
      names.push(decl.getName());
    }
  }
  return names;
}

/**
 * Is `name` referenced as an identifier in `content`?
 * Word-boundary match: `clearWishlist` matches but `clearWishlistAll` does not.
 */
function isReferenced(content: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const re = new RegExp(String.raw`\b${escaped}\b`, "u");
  return re.test(content);
}

function findUnusedInFile(apiFile: string, consumerFiles: readonly string[]): UnusedExport[] {
  const exportedNames = extractExportedFunctionNames(apiFile);
  if (exportedNames.length === 0) return [];
  const unused: UnusedExport[] = [];
  for (const name of exportedNames) {
    const referenced = consumerFiles.some((consumer) => {
      if (consumer === apiFile) return false;
      const content = readFileSync(consumer, "utf-8");
      return isReferenced(content, name);
    });
    if (!referenced) {
      unused.push({ file: apiFile.replace(REPO_ROOT + "/", ""), name });
    }
  }
  return unused;
}

function main(): void {
  const strict = process.argv.includes("--strict");
  const apiDir = parseCliFlag("--api-dir") ?? DEFAULT_API_DIR;
  const consumerRoot = parseCliFlag("--consumer-root") ?? DEFAULT_CONSUMER_ROOT;

  const apiFiles = walkTs(apiDir);
  if (apiFiles.length === 0) {
    console.log(`validate-helper-usage: no API helpers under ${apiDir} — nothing to check.`);
    process.exit(0);
  }

  const consumerFiles = walkTs(consumerRoot, (p) => !p.includes("/_legacy-v0.1.x/"));

  const unused: UnusedExport[] = apiFiles.flatMap((f) => findUnusedInFile(f, consumerFiles));

  if (unused.length === 0) {
    console.log(`validate-helper-usage: clean (${apiFiles.length} API helper file(s) checked).`);
    process.exit(0);
  }

  const severity = strict ? "error" : "warning";
  for (const u of unused) {
    console.log(
      `::${severity} file=${u.file}::Exported function \`${u.name}\` is never referenced outside its declaration file. Either wire it into a spec/fixture or remove the export.`,
    );
  }
  console.log(
    `\nvalidate-helper-usage: ${unused.length} unused export(s) found (severity: ${severity}).`,
  );
  process.exit(strict ? 1 : 0);
}

main();
