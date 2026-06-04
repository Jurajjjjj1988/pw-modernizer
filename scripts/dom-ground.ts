#!/usr/bin/env tsx
/**
 * dom-ground.ts — validate generated locators against the live DOM of the SUT.
 *
 * v1.0 Risk-1 closure (per `docs/playwright-mcp-integration.md`). This script
 * is the contract surface for the playwright-mcp integration. Phases shipped:
 *
 *   - Phase 1: CLI contract, report shape, exit codes — DONE.
 *   - Phase 2: ts-morph locator parser (walks every page.getByX / page.locator
 *     call in the probed spec file) — DONE.
 *   - Phase 3: MCP probe driver. Currently STUB — defers to a mock when the URL
 *     uses the `mock://` scheme. Real MCP wiring lands in Phase 4 (separate PR
 *     once `@playwright/mcp` is added to devDependencies).
 *
 * Why ship the stub now: the report shape + locator parser + exit-code logic
 * are the parts the downstream stages (verify, dashboard, label gates) depend
 * on. Wiring the live MCP later swaps the probe driver only; the contract
 * stays stable.
 *
 * CLI:
 *   npx tsx scripts/dom-ground.ts \
 *     --url $MIGRATION_TARGET_URL \
 *     --probe outputs/tests/<basename>.spec.ts \
 *     --report outputs/reports/<basename>-dom-probe.json \
 *     [--mode mock|live]
 *
 * Exit codes (per docs/playwright-mcp-integration.md §4):
 *   0 — every probed locator resolved uniquely
 *   1 — at least one locator failed (downstream demote/fail decisions)
 *   2 — could not reach the SUT (live mode) or MCP unavailable
 *
 * Mock URL scheme (for fixture testing without a real SUT):
 *   mock://always-resolve   — every probed locator returns 1 match
 *   mock://always-fail      — every probed locator returns 0 matches
 *   mock://ambiguous-N      — every probed locator returns N matches (N >= 2)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Project, SyntaxKind, type CallExpression, type Node } from "ts-morph";
import { chromium, type Browser, type Page } from "playwright";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

type DomVerdict = "resolved-unique" | "resolved-multiple" | "not-found" | "skipped";

interface ProbedLocator {
  locator: string;
  file: string;
  line: number;
  claimedConfidence: "high" | "med" | "low" | "unknown";
  domVerdict: DomVerdict;
  domEvidence: string;
  matches: number;
  demotedTo: "med" | "low" | null;
}

interface ProbeReport {
  timestamp: string;
  url: string;
  mode: "live" | "mock";
  totalLocators: number;
  resolvedUnique: number;
  resolvedMultiple: number;
  notFound: number;
  skipped: number;
  results: ProbedLocator[];
}

interface CliArgs {
  url: string;
  probe: string;
  report: string;
  mode: "live" | "mock";
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      probe: { type: "string" },
      report: { type: "string" },
      mode: { type: "string", default: "mock" },
    },
    strict: true,
  });
  if (!values.url || !values.probe || !values.report) {
    process.stderr.write(
      "Usage: dom-ground --url <url> --probe <spec.ts> --report <out.json> [--mode mock|live]\n",
    );
    process.exit(2);
  }
  const mode = values.mode === "live" ? "live" : "mock";
  return { url: values.url, probe: values.probe, report: values.report, mode };
}

const LOCATOR_METHODS = new Set([
  "getByRole",
  "getByLabel",
  "getByTestId",
  "getByText",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "locator",
]);

function isLocatorCall(call: CallExpression): boolean {
  const expr = call.getExpression();
  if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return false;
  const name = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
  return LOCATOR_METHODS.has(name);
}

function readConfidenceComment(node: Node): ProbedLocator["claimedConfidence"] {
  const leadingRanges = node.getLeadingCommentRanges();
  for (const range of leadingRanges) {
    const text = range.getText().toLowerCase();
    if (/confidence:\s*high/.test(text)) return "high";
    if (/confidence:\s*med(?:ium)?/.test(text)) return "med";
    if (/confidence:\s*low/.test(text)) return "low";
  }
  return "unknown";
}

function extractLocators(probePath: string): ProbedLocator[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  const src = readFileSync(probePath, "utf-8");
  const sourceFile = project.createSourceFile(probePath, src, { overwrite: true });
  const results: ProbedLocator[] = [];
  const relPath = relative(REPO_ROOT, probePath);

  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    if (!isLocatorCall(call)) return;
    const { line } = sourceFile.getLineAndColumnAtPos(call.getStart());
    // Find the enclosing statement so leading-comment lookup catches comments
    // attached above the awaited expect/click, not just the bare CallExpression.
    let scopeForComments: Node = call;
    let parent = call.getParent();
    while (parent && !parent.isKind(SyntaxKind.Block) && !parent.isKind(SyntaxKind.SourceFile)) {
      scopeForComments = parent;
      parent = parent.getParent();
    }
    results.push({
      locator: call.getText().split("\n")[0]?.trim() ?? call.getText(),
      file: relPath,
      line,
      claimedConfidence: readConfidenceComment(scopeForComments),
      domVerdict: "skipped",
      domEvidence: "",
      matches: 0,
      demotedTo: null,
    });
  });

  return results;
}

interface MockMatch {
  matches: number;
  evidence: string;
}

function applyMockProbe(url: string): MockMatch {
  if (url === "mock://always-resolve") {
    return { matches: 1, evidence: "mock: 1 element matched" };
  }
  if (url === "mock://always-fail") {
    return { matches: 0, evidence: "mock: 0 elements matched" };
  }
  const ambiguousMatch = /^mock:\/\/ambiguous-(\d+)$/.exec(url);
  if (ambiguousMatch?.[1]) {
    const n = Number.parseInt(ambiguousMatch[1], 10);
    return { matches: n, evidence: `mock: ${n} elements matched` };
  }
  return { matches: 0, evidence: "mock: unknown mock scheme, defaulting to no-match" };
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message.split("\n")[0] ?? e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}

function classifyMatches(matches: number): { verdict: DomVerdict; demotedTo: ProbedLocator["demotedTo"] } {
  if (matches === 0) return { verdict: "not-found", demotedTo: "low" };
  if (matches === 1) return { verdict: "resolved-unique", demotedTo: null };
  return { verdict: "resolved-multiple", demotedTo: "med" };
}

function mockProbe(locators: ProbedLocator[], url: string): ProbedLocator[] {
  if (!url.startsWith("mock://")) {
    process.stderr.write(
      `::error::dom-ground: --mode mock requires url to start with mock:// (got ${url})\n`,
    );
    process.exit(2);
  }
  return locators.map((loc) => {
    const { matches, evidence } = applyMockProbe(url);
    const { verdict, demotedTo } = classifyMatches(matches);
    return { ...loc, domVerdict: verdict, domEvidence: evidence, matches, demotedTo };
  });
}

const LOCATOR_CALL_RE =
  /(getByRole|getByLabel|getByTestId|getByText|getByPlaceholder|getByAltText|getByTitle|locator)\((.*)\)$/s;

async function liveProbeOne(page: Page, locatorSrc: string): Promise<{ matches: number; evidence: string }> {
  const m = LOCATOR_CALL_RE.exec(locatorSrc.replace(/^.*?\.(?=getBy|locator)/, ""));
  if (!m?.[1]) {
    return { matches: 0, evidence: "live: could not extract locator method from source" };
  }
  const method = m[1];
  // Forward the literal args verbatim through page.evaluate so we don't lose
  // option-object semantics (e.g. { name: /foo/i }) when round-tripping a
  // string. Wrap the page.<method>(args) call inside a function string and
  // resolve its count() via Playwright API.
  try {
    const args = m[2] ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Playwright Page methods are dynamically dispatched here
    const fn = new Function("page", `return page.${method}(${args}).count();`) as (p: Page) => Promise<number>;
    const matches = await fn(page);
    if (matches === 1) {
      return { matches, evidence: `live: 1 element matched ${method}(${args.slice(0, 60)}...)` };
    }
    return { matches, evidence: `live: ${matches} elements matched ${method}(${args.slice(0, 60)}...)` };
  } catch (e: unknown) {
    return { matches: 0, evidence: `live: probe threw — ${describeError(e)}` };
  }
}

async function liveProbe(locators: ProbedLocator[], url: string): Promise<ProbedLocator[]> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e: unknown) {
      process.stderr.write(`::error::dom-ground: failed to reach ${url} — ${describeError(e)}\n`);
      process.exit(2);
    }
    const results: ProbedLocator[] = [];
    for (const loc of locators) {
      const { matches, evidence } = await liveProbeOne(page, loc.locator);
      const { verdict, demotedTo } = classifyMatches(matches);
      results.push({ ...loc, domVerdict: verdict, domEvidence: evidence, matches, demotedTo });
    }
    return results;
  } finally {
    if (browser) await browser.close();
  }
}

async function probeLocators(
  locators: ProbedLocator[],
  url: string,
  mode: CliArgs["mode"],
): Promise<ProbedLocator[]> {
  if (mode === "mock") return mockProbe(locators, url);
  return liveProbe(locators, url);
}

function summarize(results: ProbedLocator[]): Pick<ProbeReport, "totalLocators" | "resolvedUnique" | "resolvedMultiple" | "notFound" | "skipped"> {
  return {
    totalLocators: results.length,
    resolvedUnique: results.filter((r) => r.domVerdict === "resolved-unique").length,
    resolvedMultiple: results.filter((r) => r.domVerdict === "resolved-multiple").length,
    notFound: results.filter((r) => r.domVerdict === "not-found").length,
    skipped: results.filter((r) => r.domVerdict === "skipped").length,
  };
}

function decideExit(report: ProbeReport): number {
  if (report.totalLocators === 0) return 0; // nothing to probe = clean
  if (report.notFound > 0) return 1; // hard fail on any unresolved
  if (report.resolvedMultiple > 0) return 1; // demote-required cases also count as fail
  return 0;
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const locators = extractLocators(args.probe);
  if (locators.length === 0) {
    process.stderr.write(
      `::warning::dom-ground: 0 locators found in ${args.probe}. Probably not a spec file.\n`,
    );
  }
  const probed = await probeLocators(locators, args.url, args.mode);
  const report: ProbeReport = {
    timestamp: new Date().toISOString(),
    url: args.url,
    mode: args.mode,
    ...summarize(probed),
    results: probed,
  };
  mkdirSync(dirname(args.report), { recursive: true });
  writeFileSync(args.report, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(
    `dom-ground: ${report.totalLocators} locator(s) probed (mode=${args.mode}, url=${args.url})\n` +
      `  resolved-unique: ${report.resolvedUnique}\n` +
      `  resolved-multiple: ${report.resolvedMultiple}\n` +
      `  not-found: ${report.notFound}\n` +
      `  skipped: ${report.skipped}\n` +
      `  report: ${args.report}\n`,
  );
  process.exit(decideExit(report));
}

await main();
