#!/usr/bin/env tsx
/**
 * validate-url-portability.ts — hard gate for output domain-portability.
 *
 * The generate prompt (_fragments/forbidden-patterns.md) + migration-rules
 * §1.4.12 already ASK for relative URLs + a configured baseURL
 * (outputs/tests/playwright.config.ts sets baseURL from MIGRATION_TARGET_URL).
 * This converts that soft ask into a STRUCTURAL gate — the project's own
 * debugging discipline (CLAUDE.md): a validator-block is more durable than a
 * prompt nudge. An absolute URL in navigation pins the output to ONE host, so a
 * migration that runs green against staging cannot be repointed at prod by
 * swapping baseURL — defeating the layered architecture's centralised URL
 * ownership and the whole point of the pwm-blueprint `open()` convention.
 *
 * Flags, in outputs/tests + outputs/helper/page-object (excluding _legacy-v0.1.x):
 *   (a) `.goto('http(s)://…')`              — absolute navigation; use a relative path.
 *   (b) a `url` / `path` class field = `'http(s)://…'` — the Page's nav target.
 * Deliberately NOT flagged: `page.route(...)` (mock patterns may match external
 * hosts), `toHaveURL(...)` (assertion, not navigation), api-layer request hosts,
 * and URLs in comments — none are the UI navigation contract (avoids false positives).
 *
 *   npx tsx scripts/validate-url-portability.ts --root outputs
 *
 * Pure core (findAbsoluteUrls) is unit-tested via an in-memory source. Exit 0 =
 * portable, 1 = an absolute navigation URL was found.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const ABSOLUTE_URL = /^https?:\/\//i;

export interface UrlViolation {
  file: string;
  line: number;
  kind: "goto" | "url-field";
  url: string;
}

/** String value of a node if it is a string literal (single/double/no-substitution
 *  template), else null. */
function stringLiteralValue(node: import("ts-morph").Node | undefined): string | null {
  if (!node) return null;
  if (node.getKind() === SyntaxKind.StringLiteral) {
    return (node.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()) ?? null;
  }
  if (node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return node.asKind(SyntaxKind.NoSubstitutionTemplateLiteral)?.getLiteralValue() ?? null;
  }
  return null;
}

/**
 * Pure core: find absolute-URL navigation in one source file. `fileName` only
 * labels violations. Uses an in-memory ts-morph source so it is I/O-free + testable.
 */
export function findAbsoluteUrls(source: string, fileName = "in-memory.ts"): UrlViolation[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf: SourceFile = project.createSourceFile(fileName, source, { overwrite: true });
  const out: UrlViolation[] = [];

  // (a) `<expr>.goto('http(s)://…')` — absolute navigation.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const prop = callee.asKind(SyntaxKind.PropertyAccessExpression);
    if (prop?.getName() !== "goto") continue;
    const url = stringLiteralValue(call.getArguments()[0]);
    if (url !== null && ABSOLUTE_URL.test(url)) {
      out.push({ file: fileName, line: call.getStartLineNumber(), kind: "goto", url });
    }
  }

  // (b) a `url` / `path` class field assigned an absolute URL — the Page's nav target.
  for (const propDecl of sf.getDescendantsOfKind(SyntaxKind.PropertyDeclaration)) {
    const name = propDecl.getName();
    if (name !== "url" && name !== "path") continue;
    const url = stringLiteralValue(propDecl.getInitializer());
    if (url !== null && ABSOLUTE_URL.test(url)) {
      out.push({ file: fileName, line: propDecl.getStartLineNumber(), kind: "url-field", url });
    }
  }
  return out;
}

/** Recursively collect *.spec.ts (tests) + *.page.ts/*.block.ts (page objects),
 *  skipping the v0.1.x legacy archive. */
function collectFiles(dir: string, match: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_legacy-v0.1.x" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, match));
    else if (match(entry.name)) out.push(full);
  }
  return out;
}

function main(): number {
  const { values } = parseArgs({ options: { root: { type: "string", default: "outputs" } }, strict: true });
  const root = resolve(REPO_ROOT, values.root ?? "outputs");
  const files = [
    ...collectFiles(join(root, "tests"), (n) => n.endsWith(".spec.ts")),
    ...collectFiles(join(root, "helper", "page-object"), (n) => n.endsWith(".page.ts") || n.endsWith(".block.ts")),
  ];
  const violations: UrlViolation[] = [];
  for (const f of files) {
    for (const v of findAbsoluteUrls(readFileSync(f, "utf8"), relative(REPO_ROOT, f))) {
      violations.push(v);
    }
  }
  if (violations.length === 0) {
    process.stdout.write(`URL portability ✓ — no absolute navigation URL (${files.length} file(s) scanned; relative paths + baseURL).\n`);
    return 0;
  }
  process.stderr.write(`URL portability ✗ — ${violations.length} absolute navigation URL(s) (pins the output to one host; use a relative path + baseURL):\n`);
  for (const v of violations) {
    const how = v.kind === "goto" ? "goto(absolute)" : "url/path field = absolute";
    process.stderr.write(`  - ${v.file}:${v.line} ${how} → ${v.url}\n`);
  }
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
