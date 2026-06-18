#!/usr/bin/env tsx
/**
 * validate-todo-discipline.ts — fails CI when generated outputs leave bare
 * TODO/FIXME comments without a recognized justification suffix.
 *
 * Background: PR #151 (AddCookiesJupiterTest) verify Code Review flagged a
 * block-severity issue — the migration report claimed `Forbidden patterns: None`
 * while a bare `// TODO:` lived in the committed POM file. §8 of generate.md
 * forbids TODO/FIXME unless the comment ties back to a known justification.
 *
 * Allowed TODO forms (case-insensitive on prefix, must appear on the same line
 * as the TODO/FIXME token):
 *   - `// TODO: Q<digits> — ...`       (low-confidence plan question reference)
 *   - `// TODO: fragile selector ...`  (intentional `.nth()` / array index)
 *   - `// TODO: add testid ...`        (xpath / brittle locator fallback)
 *   - `// TODO: <issue-id> ...`        (linked ticket like JIRA-123 or #42)
 *
 * Anything else is a discipline violation that depresses verify confidence.
 *
 * CLI:
 *   npx tsx scripts/validate-todo-discipline.ts \
 *     --root outputs/tests --root outputs/helper
 *
 * Exit codes:
 *   0 = clean
 *   1 = at least one bare TODO found (::error:: annotated)
 *
 * Strict TS, no any.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

interface CliArgs {
  roots: string[];
}

interface Violation {
  file: string;
  line: number;
  message: string;
}

/**
 * One regex per allowed justification. A TODO line passes if at least one
 * matches the substring AFTER the `TODO:` / `FIXME:` marker. Comments without
 * a colon (e.g. `// TODO refactor later`) are treated as bare and fail.
 */
const ALLOWED_JUSTIFICATIONS: readonly RegExp[] = [
  /\bQ\d+\b/i,
  /\bfragile selector\b/i,
  /\badd testid\b/i,
  /\b[A-Z]{2,}-\d+\b/,
  /#\d+/,
];

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      root: { type: "string", multiple: true },
    },
  });
  const roots = (values.root ?? []) as string[];
  if (roots.length === 0) {
    throw new Error("--root is required (one or more times)");
  }
  return { roots };
}

function* walkTypeScriptFiles(root: string): Generator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() ?? "";
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(current, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && /\.(ts|tsx|js|jsx)$/.test(name)) {
        yield full;
      }
    }
  }
}

/**
 * Find the TODO/FIXME marker (case-insensitive) and return everything that
 * follows it on the same line. If no colon is present after the marker, return
 * null — that's a bare TODO with no justification slot at all.
 */
function extractJustification(line: string): string | null {
  const m = /\b(TODO|FIXME|HACK|XXX)\b\s*:?\s*(.*)$/i.exec(line);
  if (m === null) return null;
  const afterMarker = m[2] ?? "";
  return afterMarker.trim();
}

function lineIsAllowed(justification: string): boolean {
  if (justification.length === 0) return false;
  return ALLOWED_JUSTIFICATIONS.some((rx) => rx.test(justification));
}

function scanFile(path: string, repoRoot: string): Violation[] {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: Violation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!/\b(TODO|FIXME|HACK|XXX)\b/i.test(line)) continue;
    if (!/^\s*(\/\/|\/\*|\*|#)/.test(line)) continue;
    const j = extractJustification(line);
    if (j === null) continue;
    if (lineIsAllowed(j)) continue;
    out.push({
      file: relative(repoRoot, path) || path,
      line: i + 1,
      message: `bare TODO/FIXME without recognized justification. Add one of: 'Q<n>' (plan question), 'fragile selector', 'add testid', '<TICKET-123>', or '#<issue-no>'. Found: '${j.slice(0, 100)}'`,
    });
  }
  return out;
}

function annotate(v: Violation): void {
  process.stderr.write(`::error file=${v.file},line=${v.line}::${v.message}\n`);
}

function main(): number {
  const args = parseCliArgs();
  const repoRoot = process.cwd();
  const violations: Violation[] = [];
  let scanned = 0;
  for (const root of args.roots) {
    for (const file of walkTypeScriptFiles(root)) {
      scanned++;
      violations.push(...scanFile(file, repoRoot));
    }
  }
  if (violations.length === 0) {
    process.stdout.write(`validate-todo-discipline: ${scanned} file(s) scanned — clean.\n`);
    return 0;
  }
  for (const v of violations) annotate(v);
  process.stderr.write(`validate-todo-discipline: ${violations.length} bare TODO(s) across ${scanned} file(s)\n`);
  return 1;
}

process.exit(main());
