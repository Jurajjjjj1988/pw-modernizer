#!/usr/bin/env node
/**
 * plan-envelope-validate.ts — validates the Stage 1 -> Stage 2 contract.
 *
 * Two validation modes:
 *   1. --envelope <path>            — JSON Schema validation only.
 *   2. --envelope <path> --code <p> — schema + plan-vs-code coverage:
 *      every scenarios[].id appears as exactly one `// plan:scenario=<id>`
 *      comment in code; every requiredPOMs[]/requiredFixtures[] path exists;
 *      subtractive=true bans new framework imports beyond @playwright/test.
 *
 * Background: LPW (arXiv 2411.14503) advocates plan verification with logical
 * specs; Routine (arXiv 2507.14447) argues NL plans drift. This envelope is
 * the structured contract that lets Stage 2's output be mechanically checked
 * against Stage 1's intent. Opt-in for v0.4 — enforcement lives in plan.yml at
 * v0.5.
 *
 * Exit codes: 0 = clean, 1 = one or more violations (::error:: annotated).
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Project, SyntaxKind, type SourceFile, type Node } from "ts-morph";
import Ajv2020, { type AnySchema, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import { type Framework } from "./lib/frameworks.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const SCHEMA_PATH = join(REPO_ROOT, "scripts", "plan-envelope.schema.json");

interface Args { envelope: string; code?: string }
interface Scenario { id: string; title: string; userAction: string; expectedAssertions: string[] }
interface Envelope {
  inputBasename: string;
  sourceFramework: Framework;
  subtractive: boolean;
  scenarios: Scenario[];
  requiredPOMs: string[];
  requiredFixtures: string[];
  locatorTable: Array<{ original: string; target: string; confidence: "high" | "med" | "low"; notes?: string }>;
  hallucinationDefensePins: Array<{ pinId: number; elementDescription: string; assumedLocator: string; sourceLocator: string; whyComment: string; reviewerFallback: string }>;
  expectedMetrics: { selectorQualityScore: number; smellCountDelta: number; locDelta: number; antiPatternCoverage: string };
}
interface Violation { file: string; line: number; message: string }

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      envelope: { type: "string" },
      code: { type: "string" },
    },
  });
  if (!values.envelope) throw new Error("--envelope is required");
  const out: Args = { envelope: values.envelope };
  if (values.code !== undefined) out.code = values.code;
  return out;
}

function annotate(v: Violation): void {
  process.stderr.write(`::error file=${v.file},line=${v.line}::${v.message}\n`);
}

function loadSchemaValidator(): ValidateFunction {
  const schemaSrc = readFileSync(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(schemaSrc) as AnySchema;
  // Ajv2020 ships as a CJS default export; under esModuleInterop the .default
  // form is the constructor. Handle both shapes defensively.
  const Ctor = (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020;
  const ajv = new Ctor({ allErrors: true, strict: true });
  return ajv.compile(schema);
}

function validateSchema(envelopePath: string, raw: unknown): { ok: boolean; errors: Violation[] } {
  const validate = loadSchemaValidator();
  if (validate(raw)) return { ok: true, errors: [] };
  const errs: ErrorObject[] = validate.errors ?? [];
  return {
    ok: false,
    errors: errs.map((e) => ({
      file: envelopePath,
      line: 1,
      message: `schema: ${e.instancePath || "(root)"} ${e.message ?? "invalid"}`,
    })),
  };
}

/**
 * Collect every `// plan:scenario=<id>` comment in a generated test file.
 * Pulls leading/trailing comment ranges via ts-morph (covers JSDoc + line
 * comments). Walks ALL nodes to catch comments inside describe/test blocks.
 */
function collectScenarioPins(sf: SourceFile): Map<string, number> {
  const out = new Map<string, number>();
  const rx = /\/\/\s*plan:scenario=(\d+\.\d+)/g;
  const seen = new Set<string>();
  sf.forEachDescendant((node: Node) => {
    for (const range of [...node.getLeadingCommentRanges(), ...node.getTrailingCommentRanges()]) {
      const key = `${range.getPos()}:${range.getEnd()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = range.getText();
      for (const m of text.matchAll(rx)) {
        const id = m[1];
        if (id === undefined) continue;
        out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
  });
  return out;
}

/**
 * Resolve a path that may be a file or a directory of test files.
 *
 * Directory mode: only `*.spec.ts` files are scanned (per ROADMAP v1.0 "Plan
 * envelope enforcement" — scenario pins live on test blocks, which only ever
 * appear in spec files; POMs and fixtures intentionally have no pins). A bare
 * file path is treated as a leaf spec regardless of extension so callers can
 * point at a single non-`.spec.ts` file for unit tests / one-offs.
 */
function resolveCodeFiles(codeArg: string): string[] {
  const abs = resolve(codeArg);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return [abs];
  const proj = new Project({ useInMemoryFileSystem: false });
  proj.addSourceFilesAtPaths(join(abs, "**/*.spec.ts"));
  // Exclude `_legacy-v0.1.x/` archive — those specs were emitted by past
  // migrations and carry their own scenario pins. Including them double-
  // counts pins when the new emission's basename matches a legacy file
  // (e.g. ExplicitWaitJupiterTest.java → explicit-wait-jupiter-test.spec.ts
  // exists in both _legacy/ and tests/ root → '1.1 pinned 2 times' false
  // positive). Observed 2026-06-16 run 27627784309.
  return proj.getSourceFiles()
    .map((sf) => sf.getFilePath())
    .filter((p) => !p.includes("/_legacy-v0.1.x/"));
}

/**
 * Convert envelope.inputBasename to a LIST of plausible emitted spec basenames.
 * Per `migration-rules.md` §"File naming" + `prompts/generate.md` Bullet 14,
 * Stage 2 emits kebab-case `<basename>.spec.ts`. In practice Sonnet often
 * drops a trailing `-test` because `.spec.ts` already implies a test file:
 *   PromptJupiterTest.java → prompt-jupiter.spec.ts (observed) OR
 *                             prompt-jupiter-test.spec.ts (literal kebab)
 *   FluentWaitJupiterTest.java → fluent-wait-jupiter.spec.ts (observed in main)
 * We accept both forms to avoid forcing Sonnet into a stylistic corner that
 * doesn't change the contract.
 *
 * Other cases:
 *   using_selenium_tests.py     → using-selenium-tests.spec.ts (snake → kebab)
 *   checkout_flow.cy.js         → checkout-flow.spec.ts (also dropping `-test`)
 *   selenium-java-03-multifile  → selenium-java-03-multifile.spec.ts (dir basename)
 */
function expectedSpecBasenames(inputBasename: string): string[] {
  const stem = inputBasename.replace(/\.(java|py|cy\.[jt]s|spec\.[jt]s|[jt]s)$/i, "");
  const kebab = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
  const out = new Set<string>([`${kebab}.spec.ts`]);
  // Drop redundant trailing `-test` / `-tests` — Sonnet's observed rename
  // when the .spec.ts extension already implies test-ness.
  const dropTrailingTest = kebab.replace(/-tests?$/, "");
  if (dropTrailingTest !== kebab) out.add(`${dropTrailingTest}.spec.ts`);
  // Drop leading `test-` — Python's pytest convention is `test_<thing>.py`,
  // but Playwright's convention is `<thing>.spec.ts` (the test-ness is in
  // the `.spec.ts` extension). Sonnet correctly applies this rename:
  //   test_employees.py → employees.spec.ts (observed 2026-06-16 run 27623843129)
  //   test_login.py     → login.spec.ts
  // Without this, the filterCodePathsByInput fallback runs over ALL specs
  // in outputs/tests/ and accumulates pin counts across unrelated migrations
  // (every spec legitimately starts numbering at 1.1, so the count for any
  // shared scenario id explodes).
  const dropLeadingTest = kebab.replace(/^test-/, "");
  if (dropLeadingTest !== kebab) out.add(`${dropLeadingTest}.spec.ts`);
  return Array.from(out);
}

/**
 * Filter codePaths to specs that BELONG to this envelope's input. The
 * directory walked via `--code outputs/tests/` accumulates specs from every
 * Stage 2 run; without this filter, pin counts aggregate across unrelated
 * inputs and every scenario id 1.1 gets flagged "pinned N times".
 *
 * Match strategy — basename equals one of the candidates OR starts with one
 * of the candidate stems (covers sibling specs like `<base>.helpers.spec.ts`).
 * When NO file matches, fall back to ALL codePaths — preserves the legacy
 * behaviour for cross-language migrations where Sonnet may rename further.
 */
function filterCodePathsByInput(envelope: Envelope, codePaths: string[]): string[] {
  const candidates = expectedSpecBasenames(envelope.inputBasename);
  const stems = candidates.map((c) => c.replace(/\.spec\.ts$/, ""));
  const matches = codePaths.filter((p) => {
    const b = p.split("/").pop() ?? "";
    if (candidates.includes(b)) return true;
    return stems.some((s) => b.startsWith(`${s}.`));
  });
  return matches.length > 0 ? matches : codePaths;
}

function validateScenarioCoverage(envelope: Envelope, codePaths: string[]): Violation[] {
  // Scope to specs that belong to THIS envelope's input. Without this filter,
  // a directory-mode --code aggregates pins across every Stage 2 output in
  // `outputs/tests/` and flags scenario id 1.1 as "pinned N times" once you
  // have N specs (each input legitimately starts numbering at 1.1).
  const scoped = filterCodePathsByInput(envelope, codePaths);
  if (scoped.length === 0) return [];
  const project = new Project({ useInMemoryFileSystem: false });
  const aggregated = new Map<string, number>();
  for (const p of scoped) {
    const sf = project.addSourceFileAtPath(p);
    for (const [id, count] of collectScenarioPins(sf)) {
      aggregated.set(id, (aggregated.get(id) ?? 0) + count);
    }
  }
  const out: Violation[] = [];
  const expected = new Set(envelope.scenarios.map((s) => s.id));
  for (const id of expected) {
    const n = aggregated.get(id) ?? 0;
    if (n === 0) {
      out.push({
        file: scoped[0] ?? "(code)",
        line: 1,
        message: `scenario id '${id}' has no '// plan:scenario=${id}' pin in generated code`,
      });
    } else if (n > 1) {
      out.push({
        file: scoped[0] ?? "(code)",
        line: 1,
        message: `scenario id '${id}' pinned ${n} times — must be exactly one`,
      });
    }
  }
  for (const id of aggregated.keys()) {
    if (!expected.has(id)) {
      out.push({
        file: scoped[0] ?? "(code)",
        line: 1,
        message: `code pins scenario '${id}' that is not declared in envelope.scenarios`,
      });
    }
  }
  return out;
}

// v0.1.x plans declared POMs/blocks/fixtures under `outputs/tests/{pages,
// blocks,fixtures}/`. qa-master v0.2.0 moved them under
// `outputs/helper/{page-object/pages,page-object/blocks,fixtures}/`. Old
// envelopes (pre-2026-06-10) still reference the v0.1.x paths; Stage 2
// emits to the new location. Map old path → equivalent qa-master path so
// the validator accepts the file even though the envelope is stale.
// Observed 2026-06-16 run 27649532990 (EmployeesTest.java).
const QA_MASTER_PATH_FALLBACKS: ReadonlyArray<readonly [string, string]> = [
  ["outputs/tests/pages/", "outputs/helper/page-object/pages/"],
  ["outputs/tests/blocks/", "outputs/helper/page-object/blocks/"],
  ["outputs/tests/fixtures/", "outputs/helper/fixtures/"],
];

function existsAtQaMasterFallback(legacyPath: string): boolean {
  for (const [oldPrefix, newPrefix] of QA_MASTER_PATH_FALLBACKS) {
    if (!legacyPath.startsWith(oldPrefix)) continue;
    const candidate = newPrefix + legacyPath.slice(oldPrefix.length);
    if (existsSync(resolve(REPO_ROOT, candidate))) return true;
  }
  return false;
}

function validatePomFixturePaths(envelope: Envelope, envelopePath: string): Violation[] {
  const out: Violation[] = [];
  for (const p of [...envelope.requiredPOMs, ...envelope.requiredFixtures]) {
    if (existsSync(resolve(REPO_ROOT, p))) continue;
    if (existsAtQaMasterFallback(p)) continue;
    out.push({
      file: envelopePath,
      line: 1,
      message: `requiredPOMs/requiredFixtures path missing on disk: ${p}`,
    });
  }
  return out;
}

function validateSubtractiveImports(envelope: Envelope, codePaths: string[]): Violation[] {
  if (!envelope.subtractive || codePaths.length === 0) return [];
  // Same scope discipline as scenario coverage — only inspect specs belonging
  // to THIS envelope's input. Otherwise we'd flag a Cypress migration's
  // `import { defineConfig } from 'cypress'` as a violation for an unrelated
  // bad-Playwright envelope being validated against the same outputs/tests/.
  const scoped = filterCodePathsByInput(envelope, codePaths);
  if (scoped.length === 0) return [];
  const out: Violation[] = [];
  // Allow Playwright core, node built-ins, relative imports, AND qa-master path
  // aliases. Path aliases (@fixtures, @page-object, @api, etc.) resolve to local
  // helper files under outputs/helper/ — they're the same framework (Playwright)
  // routed through qa-master architecture, not foreign framework imports. The
  // subtractive flag's purpose is to prevent ADDING a new framework (Cypress,
  // Selenium); qa-master aliases are bookkeeping for the existing one.
  const allowed = new Set(["@playwright/test", "playwright"]);
  const allowedAliasPrefixes = [
    "@fixtures/", "@page-object/", "@page-object",
    "@api/", "@actions/", "@browser/",
    "@utilities/", "@test-data/", "@type-defs/",
    "@logger",
  ];
  const project = new Project({ useInMemoryFileSystem: false });
  for (const p of scoped) {
    const sf = project.addSourceFileAtPath(p);
    for (const imp of sf.getDescendantsOfKind(SyntaxKind.ImportDeclaration)) {
      const mod = imp.getModuleSpecifierValue();
      if (mod.startsWith(".") || mod.startsWith("/")) continue;
      if (mod.startsWith("node:")) continue; // node built-ins always allowed
      if (allowed.has(mod)) continue;
      // qa-master path aliases resolve to local helper files — not foreign.
      if (allowedAliasPrefixes.some((prefix) => mod === prefix || mod.startsWith(prefix))) continue;
      out.push({
        file: p,
        line: imp.getStartLineNumber(),
        message: `subtractive migration introduced foreign framework import '${mod}' — only @playwright/test + relative + node: + qa-master path aliases allowed`,
      });
    }
  }
  return out;
}

function main(): number {
  const args = parseCliArgs();
  const envelopePath = resolve(args.envelope);
  if (!existsSync(envelopePath)) {
    process.stderr.write(`::error::envelope file missing: ${envelopePath}\n`);
    return 1;
  }
  const raw: unknown = JSON.parse(readFileSync(envelopePath, "utf8"));
  const schemaResult = validateSchema(envelopePath, raw);
  if (!schemaResult.ok) {
    schemaResult.errors.forEach(annotate);
    process.stderr.write(`plan-envelope-validate: ${schemaResult.errors.length} schema violation(s)\n`);
    return 1;
  }
  const envelope = raw as Envelope;
  const violations: Violation[] = [];
  // requiredPOMs / requiredFixtures: only enforce existence when --code is also
  // provided, since standalone schema validation runs on the example envelope
  // before any code generation has happened.
  if (args.code !== undefined) {
    const codePaths = resolveCodeFiles(args.code);
    if (codePaths.length === 0) {
      violations.push({ file: args.code, line: 1, message: `--code path not found or empty: ${args.code}` });
    } else {
      violations.push(
        ...validateScenarioCoverage(envelope, codePaths),
        ...validateSubtractiveImports(envelope, codePaths),
        ...validatePomFixturePaths(envelope, envelopePath),
      );
    }
  }
  if (violations.length > 0) {
    violations.forEach(annotate);
    process.stderr.write(`plan-envelope-validate: ${violations.length} contract violation(s)\n`);
    return 1;
  }
  const mode = args.code === undefined ? "schema only" : "schema + code coverage";
  process.stdout.write(
    `plan-envelope-validate: ${envelope.scenarios.length} scenario(s), ${envelope.locatorTable.length} locator(s), ${envelope.hallucinationDefensePins.length} pin(s) — clean (${mode}).\n`,
  );
  return 0;
}

process.exit(main());
