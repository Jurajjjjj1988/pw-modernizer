#!/usr/bin/env tsx
/**
 * validate-pom-provenance.ts — catch cross-migration POM contamination (DEF2).
 *
 * The shared pwm-blueprint tree (outputs/helper) accumulates page objects from every
 * migration. When two migrations against DIFFERENT apps both author the same
 * shared file (e.g. login.page.ts), the second OVERWRITES the first: the file
 * ends up holding only the second app's locators, while the FIRST migration's
 * spec still imports it and now references locators that no longer exist — yet
 * both specs compiled in isolation, so every static gate passed it green. Running
 * the first spec against its real app then fails. (Found by a multi-agent hunt;
 * matches the W16 lever in docs/quality-research-findings.md.)
 *
 * Every generated POM carries `// See outputs/plans/<plan>.md`. We flag the one
 * signal that is UNAMBIGUOUS: a single POM that carries >1 distinct plan reference
 * — it was literally authored by two migrations (co-authored contamination).
 *
 * We deliberately do NOT flag "a spec reaches a POM whose plan != the spec's":
 * that is indistinguishable from LEGITIMATE pwm-blueprint reuse (spec B intentionally
 * reusing spec A's page object — the whole point of the shared tree). Verified by
 * running this gate against the committed corpus, where it false-positived on real
 * reuse (silent-conditionals reusing force-clicks's dashboard.page.ts). The
 * OVERWRITE-with-different-app-locators case has no reliable STATIC signal — a
 * wrong-app locator looks identical to a right-app one without the live DOM — so
 * it is caught by the execution gate (run-against-sut) + prevented by batch-mode
 * isolation (the proper fix for the --inputs path; backlog). This gate is the
 * cheap, zero-false-positive net for the co-authored case.
 *
 *   npx tsx scripts/validate-pom-provenance.ts --root outputs
 *
 * Pure core (extractPlanRefs / findProvenanceIssues) is unit-tested.
 * Exit 0 = no co-authored POM; 1 = a shared POM was authored by >1 migration.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

export interface ProvenanceIssue {
  pom: string;
  kind: "co-authored";
  detail: string;
}

/** All distinct `outputs/plans/<plan>.md` references in a file (the migration(s)
 * that authored it). A shared scaffolding file (basepage/baseblock/base.fixture)
 * carries none. */
export function extractPlanRefs(content: string): string[] {
  const refs = new Set<string>();
  const re = /outputs\/plans\/(\S+?\.md)/g;
  for (let m = re.exec(content); m !== null; m = re.exec(content)) refs.add(m[1] ?? "");
  return [...refs].filter((r) => r.length > 0);
}

/**
 * The UNAMBIGUOUS contamination signal: a POM that carries >1 distinct plan
 * reference was authored by >1 migration. Pure — the caller does file I/O. We do
 * NOT flag a single-plan POM reached by a different spec's plan: that is legitimate
 * pwm-blueprint reuse, not contamination (no reliable static way to tell them apart).
 */
export function findProvenanceIssues(poms: { path: string; planRefs: string[] }[]): ProvenanceIssue[] {
  const issues: ProvenanceIssue[] = [];
  for (const pom of poms) {
    if (pom.planRefs.length > 1) {
      issues.push({ pom: pom.path, kind: "co-authored", detail: `carries ${pom.planRefs.length} distinct plans: ${pom.planRefs.join(", ")}` });
    }
  }
  return issues;
}

/** Recursively collect *.page.ts / *.block.ts under a directory. */
function collectPomFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectPomFiles(full));
    else if (entry.name.endsWith(".page.ts") || entry.name.endsWith(".block.ts")) out.push(full);
  }
  return out;
}

function main(): number {
  const { values } = parseArgs({ options: { root: { type: "string", default: "outputs" } }, strict: true });
  const helper = resolve(REPO_ROOT, values.root ?? "outputs", "helper", "page-object");
  const poms = collectPomFiles(helper).map((f) => ({ path: relative(REPO_ROOT, f), planRefs: extractPlanRefs(readFileSync(f, "utf8")) }));
  const issues = findProvenanceIssues(poms);
  if (issues.length === 0) {
    process.stdout.write(`POM provenance ✓ — no page object is co-authored by >1 migration (${poms.length} POM(s) scanned).\n`);
    return 0;
  }
  process.stderr.write(`POM provenance ✗ — ${issues.length} co-authored page object(s) (cross-migration contamination):\n`);
  for (const i of issues) process.stderr.write(`  - ${i.pom} ${i.detail}\n`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
