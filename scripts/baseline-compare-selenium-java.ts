#!/usr/bin/env node
/**
 * baseline-compare-selenium-java.ts — deterministic quality baseline that
 * compares Sonnet's actual selenium-java migration outputs against the
 * curated golden under `examples/selenium-java-03-multifile-login/expected-output/`.
 *
 * Why this exists (v0.5 ROADMAP quality signal):
 *   The selenium-java cross-framework path was exercised once during v0.2.0
 *   closure (PR #3 landed the EmployeesTest plan; Stage 2 produced spec
 *   outputs in `outputs/tests/`). Without a baseline, every new selenium-java
 *   run is judged ad hoc. This script answers ONE question per run:
 *     "Did Sonnet drift away from the golden style on the comparison axes
 *      we care about?"
 *
 * What it compares (axes only, NOT semantic equivalence — the inputs are
 * different programs, so behavioural diff is impossible):
 *   1. Anti-pattern counts (waitForTimeout / page.goto-in-specs / raw
 *      .locator( / raw nth() ) on BOTH sides. A FLAG fires when Sonnet
 *      introduces an anti-pattern that the golden has zero of.
 *   2. Locator-API inventory (getByRole / getByTestId / getByLabel /
 *      getByPlaceholder). Reported as totals — drift is informational, no
 *      flag (e.g. Sonnet may correctly use more getByLabel than the golden).
 *   3. KB-ID coverage — every `// KB:` cited ID on Sonnet's side must
 *      appear in the golden's set, OR be a documented post-v0.2.0 KB ID
 *      (e.g. qa-master/* namespace). Flag IDs the golden never cites.
 *   4. Structural delta — count of specs / POMs / fixtures / helpers on
 *      both sides. Flag drift > 0 in any bucket (the golden is the shape
 *      bar; Sonnet should emit a similar split).
 *
 * Verdict semantics:
 *   The final line is one of:
 *     `Baseline: OK`     — no flags fired across all four axes
 *     `Baseline: DRIFT`  — at least one flag fired (informational; not a gate)
 *
 *   The verdict is grep-able by a future workflow step (`grep '^Baseline: '`).
 *   This script ALWAYS exits 0 — DRIFT is a quality SIGNAL, not a CI gate.
 *   The semantic-regression workflow already enforces hard thresholds; this
 *   feeds v0.5 quality tracking with a cheap, human-readable delta.
 *
 * When to run:
 *   - After every selenium-java Stage 2 output lands in `outputs/tests/`
 *   - Before tagging a v0.5.x release as part of the quality-signal sweep
 *   - Locally: `npm run baseline:selenium-java -- --stdout`
 *   - CI    : `npm run baseline:selenium-java` (writes the report file)
 *
 * Output paths:
 *   - default: `outputs/reports/baseline-selenium-java.md`
 *   - `--stdout`: writes report to stdout instead (handy for inspection)
 *
 * Source selection (Sonnet side):
 *   The script considers every spec under `outputs/tests/**\/*.spec.ts` whose
 *   sibling plan in `outputs/plans/<basename>.<ext>.md` declares a
 *   "Source framework" matching `selenium-java` (case-insensitive). It also
 *   considers the `_legacy-v0.1.x/` archive because v0.1.x specs are the
 *   only Sonnet selenium-java outputs that exist pre-Stage-2-rerun. POMs
 *   under `outputs/helper/page-object/pages/` and fixtures under
 *   `outputs/helper/fixtures/` are included when present.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, basename, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const GOLDEN_ROOT = join(
  REPO_ROOT,
  "examples",
  "selenium-java-03-multifile-login",
  "expected-output",
);
const OUTPUTS_TESTS = join(REPO_ROOT, "outputs", "tests");
const OUTPUTS_PLANS = join(REPO_ROOT, "outputs", "plans");
const OUTPUTS_HELPER = join(REPO_ROOT, "outputs", "helper");
const REPORT_DEFAULT = join(
  REPO_ROOT,
  "outputs",
  "reports",
  "baseline-selenium-java.md",
);

interface CliArgs {
  stdout: boolean;
  out: string;
}

interface FileBucket {
  specs: string[];
  poms: string[];
  fixtures: string[];
  helpers: string[];
}

interface AntiPatternCounts {
  waitForTimeout: number;
  pageGotoInSpec: number;
  rawLocator: number;
  rawNth: number;
}

interface LocatorCounts {
  getByRole: number;
  getByTestId: number;
  getByLabel: number;
  getByPlaceholder: number;
}

interface SideStats {
  files: FileBucket;
  antiPatterns: AntiPatternCounts;
  locators: LocatorCounts;
  kbIds: Set<string>;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      stdout: { type: "boolean", default: false },
      out: { type: "string", default: REPORT_DEFAULT },
    },
  });
  return {
    stdout: values.stdout === true,
    out: typeof values.out === "string" ? values.out : REPORT_DEFAULT,
  };
}

/**
 * Recursively collect files matching `predicate` under `root`. Returns
 * absolute paths. Tolerates missing roots (returns []).
 */
function walk(root: string, predicate: (path: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && predicate(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Returns true when the plan markdown for `inputBasename` (e.g.
 * `EmployeesTest.java`) declares a `## Source framework` section whose
 * body contains "selenium-java" (case-insensitive, dash- or space-separated).
 */
function planIsSeleniumJava(inputBasename: string): boolean {
  const planPath = join(OUTPUTS_PLANS, `${inputBasename}.md`);
  if (!existsSync(planPath)) return false;
  const txt = readFileSync(planPath, "utf8");
  const idx = txt.indexOf("## Source framework");
  if (idx === -1) return false;
  // Read the next ~400 chars after the heading — enough to catch the
  // framework label without snagging on the next section.
  const window = txt.slice(idx, idx + 400).toLowerCase();
  return /selenium[\s-]?java/.test(window);
}

/**
 * Map a spec file path back to its plan input basename. Strategy:
 *   1. Try the comment `Migrated from <plan-basename>` (legacy v0.1.x form).
 *   2. Try `outputs/plans/<basename>.<ext>.md` derived from the spec name.
 *   3. Otherwise return null.
 */
function specToPlanBasename(specPath: string): string | null {
  const src = readFileSync(specPath, "utf8");
  // legacy form: "See outputs/plans/FluentWaitJupiterTest.java.md for plan"
  const m = src.match(/outputs\/plans\/([A-Za-z0-9_.-]+\.(?:java|py|js|ts|cy\.js|spec\.ts))\.md/);
  if (m !== null && m[1] !== undefined) {
    return m[1];
  }
  // Fall back to filename heuristic: spec name might map to a plan file.
  // E.g. `employees-test.spec.ts` -> `EmployeesTest.java`. We can't recover
  // the exact case-and-extension mechanically, so we just enumerate plans
  // and look for a kebab-case match.
  const stem = basename(specPath, ".spec.ts");
  if (!existsSync(OUTPUTS_PLANS)) return null;
  const plans = readdirSync(OUTPUTS_PLANS).filter((p) => p.endsWith(".md"));
  for (const plan of plans) {
    const planStem = plan.replace(/\.md$/, "");
    const kebab = planStem
      .replace(/\.[^.]+$/, "")
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");
    if (kebab === stem) return planStem;
  }
  return null;
}

/**
 * Collect golden files. Categorise by qa-master shape:
 *   - `.spec.ts`                   -> specs
 *   - `pages/*.page.ts`            -> poms
 *   - `fixtures/*.fixture.ts`      -> fixtures
 *   - other `.ts`                  -> helpers (utilities, test-data, etc.)
 */
function collectGoldenFiles(): FileBucket {
  const all = walk(GOLDEN_ROOT, (p) => p.endsWith(".ts"));
  return categorise(all, GOLDEN_ROOT);
}

/**
 * Collect Sonnet files belonging to selenium-java migrations. The selection
 * proceeds in three phases:
 *   A. Discover every `*.spec.ts` under `outputs/tests/` (including the
 *      `_legacy-v0.1.x` archive — that IS the v0.2.0-pre Sonnet output for
 *      this framework).
 *   B. Retain specs whose plan basename's source framework is selenium-java.
 *   C. Add the qa-master scaffolding (pages/, fixtures/, helpers/) if any
 *      file under those dirs is non-trivial. We include all of them today
 *      because there is no per-migration provenance link from POM files
 *      back to their input plan; on a real selenium-java POM emission they
 *      will be the relevant artefact.
 */
function collectSonnetFiles(): FileBucket {
  const specsAll = walk(OUTPUTS_TESTS, (p) => p.endsWith(".spec.ts"));
  const specs: string[] = [];
  for (const spec of specsAll) {
    const planBasename = specToPlanBasename(spec);
    if (planBasename === null) continue;
    if (planIsSeleniumJava(planBasename)) {
      specs.push(spec);
    }
  }

  const poms = walk(
    join(OUTPUTS_HELPER, "page-object", "pages"),
    (p) => p.endsWith(".page.ts"),
  );
  const fixtures = walk(
    join(OUTPUTS_HELPER, "fixtures"),
    (p) => p.endsWith(".fixture.ts"),
  );
  const helpers = walk(
    join(OUTPUTS_HELPER, "utilities"),
    (p) => p.endsWith(".ts"),
  );

  return { specs, poms, fixtures, helpers };
}

/**
 * Categorise a flat list of TS files into qa-master buckets, relative to
 * `root` for path stability.
 */
function categorise(files: string[], root: string): FileBucket {
  const out: FileBucket = { specs: [], poms: [], fixtures: [], helpers: [] };
  for (const f of files) {
    const rel = relative(root, f);
    if (rel.endsWith(".spec.ts")) {
      out.specs.push(f);
    } else if (rel.includes("pages/") || rel.endsWith(".page.ts")) {
      out.poms.push(f);
    } else if (rel.includes("fixtures/") || rel.endsWith(".fixture.ts")) {
      out.fixtures.push(f);
    } else {
      out.helpers.push(f);
    }
  }
  return out;
}

/**
 * Anti-pattern counts via plain regex over file contents.
 *
 *   - waitForTimeout : direct ban (hard wait per CLAUDE.md)
 *   - pageGotoInSpec : `page.goto(` literal in a SPEC file. POMs are allowed
 *                      to call goto; specs should delegate to a POM `open()`.
 *   - rawLocator     : `.locator(` with no role/test-id wrapper around it.
 *                      Counted naively; a single `.locator(` token is enough
 *                      to flag.
 *   - rawNth         : `nth(` or `.nth(` — positional index selection.
 */
function countAntiPatterns(files: FileBucket): AntiPatternCounts {
  let waitForTimeout = 0;
  let pageGotoInSpec = 0;
  let rawLocator = 0;
  let rawNth = 0;

  for (const spec of files.specs) {
    const txt = readFileSync(spec, "utf8");
    waitForTimeout += matchCount(txt, /\bwaitForTimeout\s*\(/g);
    pageGotoInSpec += matchCount(txt, /\bpage\.goto\s*\(/g);
    rawLocator += matchCount(txt, /\.locator\s*\(/g);
    rawNth += matchCount(txt, /\.nth\s*\(/g);
  }
  // POMs may legitimately use page.goto; only count waitForTimeout / rawNth
  // there. Raw .locator( in a POM is still a smell (POMs should prefer
  // getBy* role-based locators per qa-master §4).
  for (const file of [...files.poms, ...files.fixtures, ...files.helpers]) {
    const txt = readFileSync(file, "utf8");
    waitForTimeout += matchCount(txt, /\bwaitForTimeout\s*\(/g);
    rawLocator += matchCount(txt, /\.locator\s*\(/g);
    rawNth += matchCount(txt, /\.nth\s*\(/g);
  }

  return { waitForTimeout, pageGotoInSpec, rawLocator, rawNth };
}

/**
 * getBy* usage tallies across the whole bucket. These are signals of
 * stable-selector adoption; higher is generally better.
 */
function countLocators(files: FileBucket): LocatorCounts {
  let getByRole = 0;
  let getByTestId = 0;
  let getByLabel = 0;
  let getByPlaceholder = 0;
  const all = [...files.specs, ...files.poms, ...files.fixtures, ...files.helpers];
  for (const f of all) {
    const txt = readFileSync(f, "utf8");
    getByRole += matchCount(txt, /\bgetByRole\s*\(/g);
    getByTestId += matchCount(txt, /\bgetByTestId\s*\(/g);
    getByLabel += matchCount(txt, /\bgetByLabel\s*\(/g);
    getByPlaceholder += matchCount(txt, /\bgetByPlaceholder\s*\(/g);
  }
  return { getByRole, getByTestId, getByLabel, getByPlaceholder };
}

/**
 * Extract KB IDs cited in `// KB:` line comments. The convention is
 *   `// KB: KB-1.3.1, KB-1.1.14` or `// KB: qa-master/selectors/...`.
 * We accept both numeric (`KB-x.y.z`) and namespace (`qa-master/...`) forms.
 */
function extractKbIds(files: FileBucket): Set<string> {
  const ids = new Set<string>();
  const all = [...files.specs, ...files.poms, ...files.fixtures, ...files.helpers];
  for (const f of all) {
    const txt = readFileSync(f, "utf8");
    // Match either `// KB:` or `KB:` after a line-start whitespace
    const lines = txt.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/\/\/\s*KB:\s*(.+)$/);
      if (m === null || m[1] === undefined) continue;
      const body = m[1];
      // Numeric KB IDs
      for (const id of body.matchAll(/KB-\d+(?:\.\d+){0,3}/g)) {
        ids.add(id[0]);
      }
      // qa-master/... namespace IDs (kebab-case path)
      for (const id of body.matchAll(/qa-master\/[a-z0-9-]+(?:\/[a-z0-9-]+)*/g)) {
        ids.add(id[0]);
      }
    }
  }
  return ids;
}

function matchCount(haystack: string, pattern: RegExp): number {
  const m = haystack.match(pattern);
  return m === null ? 0 : m.length;
}

function buildSide(files: FileBucket): SideStats {
  return {
    files,
    antiPatterns: countAntiPatterns(files),
    locators: countLocators(files),
    kbIds: extractKbIds(files),
  };
}

interface Verdict {
  drift: boolean;
  flags: string[];
}

function evaluate(golden: SideStats, sonnet: SideStats): Verdict {
  const flags: string[] = [];

  // Anti-pattern flag: Sonnet introduces something the golden has zero of.
  const apKeys: (keyof AntiPatternCounts)[] = [
    "waitForTimeout",
    "pageGotoInSpec",
    "rawLocator",
    "rawNth",
  ];
  for (const k of apKeys) {
    if (golden.antiPatterns[k] === 0 && sonnet.antiPatterns[k] > 0) {
      flags.push(
        `Sonnet introduces \`${k}\` (${String(sonnet.antiPatterns[k])} occurrences) ` +
          `that the golden has zero of.`,
      );
    }
  }

  // KB-ID flag: Sonnet cites an ID the golden doesn't.
  // (We do NOT flag KB IDs the golden cites that Sonnet skips — different
  // programs may legitimately exercise different KB rules.)
  for (const id of sonnet.kbIds) {
    if (!golden.kbIds.has(id)) {
      flags.push(`Sonnet cites KB ID \`${id}\` not present in golden's KB set.`);
    }
  }

  // Structural-delta flag: any bucket count drift.
  const buckets: (keyof FileBucket)[] = ["specs", "poms", "fixtures", "helpers"];
  for (const b of buckets) {
    const g = golden.files[b].length;
    const s = sonnet.files[b].length;
    if (g !== s) {
      flags.push(
        `Structural delta in \`${b}\`: golden=${String(g)}, sonnet=${String(s)}.`,
      );
    }
  }

  // Locator inventory: informational only (no flag). The verdict ignores it.

  return { drift: flags.length > 0, flags };
}

function relPath(p: string): string {
  return relative(REPO_ROOT, p);
}

function fmtFileList(files: FileBucket, label: string): string {
  const all = [
    ...files.specs.map((f) => `spec: ${relPath(f)}`),
    ...files.poms.map((f) => `pom : ${relPath(f)}`),
    ...files.fixtures.map((f) => `fix : ${relPath(f)}`),
    ...files.helpers.map((f) => `help: ${relPath(f)}`),
  ];
  if (all.length === 0) return `- _${label} — no files found_`;
  return all.map((f) => `- \`${f}\``).join("\n");
}

function fmtKbIds(ids: Set<string>): string {
  if (ids.size === 0) return "_(none cited)_";
  return Array.from(ids).sort().map((id) => `\`${id}\``).join(", ");
}

function renderReport(golden: SideStats, sonnet: SideStats, verdict: Verdict): string {
  const lines: string[] = [];
  lines.push("# Baseline: selenium-java Sonnet output vs golden");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "Compares Sonnet's selenium-java migration output against the curated " +
      "golden under `examples/selenium-java-03-multifile-login/expected-output/`. " +
      "See `scripts/baseline-compare-selenium-java.ts` header for axes + verdict semantics.",
  );
  lines.push("");

  lines.push("## Files compared");
  lines.push("");
  lines.push("### Golden");
  lines.push("");
  lines.push(fmtFileList(golden.files, "golden"));
  lines.push("");
  lines.push("### Sonnet");
  lines.push("");
  lines.push(fmtFileList(sonnet.files, "sonnet"));
  lines.push("");

  lines.push("## Anti-pattern check");
  lines.push("");
  lines.push("| Anti-pattern | Golden | Sonnet | Flag |");
  lines.push("|---|---:|---:|:---:|");
  const apKeys: (keyof AntiPatternCounts)[] = [
    "waitForTimeout",
    "pageGotoInSpec",
    "rawLocator",
    "rawNth",
  ];
  for (const k of apKeys) {
    const g = golden.antiPatterns[k];
    const s = sonnet.antiPatterns[k];
    const flag = g === 0 && s > 0 ? "FLAG" : "ok";
    lines.push(`| \`${k}\` | ${String(g)} | ${String(s)} | ${flag} |`);
  }
  lines.push("");

  lines.push("## Locator inventory delta");
  lines.push("");
  lines.push("| Locator API | Golden | Sonnet |");
  lines.push("|---|---:|---:|");
  const locKeys: (keyof LocatorCounts)[] = [
    "getByRole",
    "getByTestId",
    "getByLabel",
    "getByPlaceholder",
  ];
  for (const k of locKeys) {
    lines.push(
      `| \`${k}\` | ${String(golden.locators[k])} | ${String(sonnet.locators[k])} |`,
    );
  }
  lines.push("");
  lines.push("_Informational only — no flag fires on locator drift._");
  lines.push("");

  lines.push("## KB-ID coverage");
  lines.push("");
  lines.push(`- **Golden KB IDs**: ${fmtKbIds(golden.kbIds)}`);
  lines.push(`- **Sonnet KB IDs**: ${fmtKbIds(sonnet.kbIds)}`);
  const sonnetExtra = Array.from(sonnet.kbIds).filter((id) => !golden.kbIds.has(id));
  if (sonnetExtra.length > 0) {
    lines.push(
      `- **Flagged (cited by Sonnet, absent from golden)**: ${sonnetExtra
        .map((id) => `\`${id}\``)
        .join(", ")}`,
    );
  } else {
    lines.push("- **Flagged**: none");
  }
  lines.push("");

  lines.push("## Structural delta");
  lines.push("");
  lines.push("| Bucket | Golden | Sonnet | Flag |");
  lines.push("|---|---:|---:|:---:|");
  const bKeys: (keyof FileBucket)[] = ["specs", "poms", "fixtures", "helpers"];
  for (const k of bKeys) {
    const g = golden.files[k].length;
    const s = sonnet.files[k].length;
    const flag = g !== s ? "FLAG" : "ok";
    lines.push(`| \`${k}\` | ${String(g)} | ${String(s)} | ${flag} |`);
  }
  lines.push("");

  if (verdict.flags.length > 0) {
    lines.push("## Flags");
    lines.push("");
    for (const f of verdict.flags) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  lines.push(verdict.drift ? "Baseline: DRIFT" : "Baseline: OK");
  return lines.join("\n") + "\n";
}

function main(): void {
  const args = parseCliArgs();

  if (!existsSync(GOLDEN_ROOT)) {
    process.stderr.write(
      `baseline-compare-selenium-java: golden root not found at ${GOLDEN_ROOT}\n`,
    );
    process.exit(0);
    return;
  }

  const golden = buildSide(collectGoldenFiles());
  const sonnet = buildSide(collectSonnetFiles());
  const verdict = evaluate(golden, sonnet);
  const report = renderReport(golden, sonnet, verdict);

  if (args.stdout) {
    process.stdout.write(report);
    return;
  }

  const outDir = dirname(args.out);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(args.out, report, "utf8");
  process.stdout.write(`baseline-compare-selenium-java: wrote ${relPath(args.out)}\n`);
  process.stdout.write(`${verdict.drift ? "Baseline: DRIFT" : "Baseline: OK"}\n`);
}

main();
