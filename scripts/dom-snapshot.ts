#!/usr/bin/env tsx
/**
 * dom-snapshot.ts — Phase 6 of DOM grounding (Stage 1 LLM enrichment).
 *
 * Captures an accessibility-tree snapshot of the SUT and writes it to
 * `outputs/dom-snapshots/<basename>.yaml`. Stage 1 (Sonnet analyze) can
 * `Read` this artifact to annotate the locator translation table with
 * DOM evidence ("confirmed" / "not-found" / "ambiguous").
 *
 * Phase 5 (Stage 2 post-generation gate) uses Playwright directly via
 * `dom-ground.ts`. Phase 6 (this script) is the Stage 1 pre-generation
 * enrichment — same Playwright instance, different consumer.
 *
 * Per the integration brief (docs/playwright-mcp-integration.md §3.1),
 * we accept the snapshot at Stage 1 so Sonnet can annotate confidence
 * BEFORE emitting the plan, instead of demoting later in verify.
 *
 * The snapshot format mirrors Playwright's `page.accessibility.snapshot()`
 * output but flattened to YAML for token efficiency. Sub-trees with no
 * `name` attribute are dropped; lists collapse past 10 items with
 * "... (N more)" markers.
 *
 * CLI:
 *   npx tsx scripts/dom-snapshot.ts \
 *     --url $MIGRATION_TARGET_URL \
 *     --output outputs/dom-snapshots/<basename>.yaml \
 *     [--max-tokens 20000]
 *
 * Exit codes:
 *   0 — snapshot written
 *   1 — unable to reach URL (downstream falls back to no-grounding)
 *   2 — snapshot exceeded --max-tokens (downstream labels PR `dom-probe:oversized`)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser } from "playwright";

interface CliArgs {
  url: string;
  output: string;
  maxTokens: number;
  flow: string;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      output: { type: "string" },
      "max-tokens": { type: "string", default: "20000" },
      // Multi-page capture for authenticated flows: a ';'-separated mini-DSL of
      // `goto <url>` | `fill <css> <value>` | `click <css>` | `snap <label>`.
      // Snapshots are taken at each `snap` and concatenated with page headers, so
      // post-login pages (inventory, cart) get grounded too — not just the entry URL.
      flow: { type: "string", default: "" },
    },
    strict: true,
  });
  const flow = values.flow ?? "";
  if ((!values.url && flow.length === 0) || !values.output) {
    process.stderr.write("Usage: dom-snapshot (--url <url> | --flow '<steps>') --output <yaml> [--max-tokens N]\n");
    process.exit(2);
  }
  return {
    url: values.url ?? "",
    output: values.output,
    maxTokens: Number.parseInt(values["max-tokens"] ?? "20000", 10),
    flow,
  };
}

type FlowStep =
  | { kind: "goto"; url: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "click"; selector: string }
  | { kind: "snap"; label: string };

/** Parse the `--flow` mini-DSL (one step per `;`). */
function parseFlow(spec: string): FlowStep[] {
  const steps: FlowStep[] = [];
  for (const raw of spec.split(";")) {
    const t = raw.trim();
    if (t.length === 0) continue;
    const parts = t.split(/\s+/);
    const kind = parts[0];
    const rest = parts.slice(1);
    if (kind === "goto") steps.push({ kind, url: rest.join(" ") });
    else if (kind === "snap") steps.push({ kind, label: rest.join(" ") || "page" });
    else if (kind === "click") steps.push({ kind, selector: rest.join(" ") });
    else if (kind === "fill") steps.push({ kind, selector: rest[0] ?? "", value: rest.slice(1).join(" ") });
    else throw new Error(`unknown flow step: '${t}'`);
  }
  return steps;
}

/** Run an authenticated flow in one page, snapshotting at each `snap` marker. */
async function captureFlow(steps: FlowStep[]): Promise<string> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const parts: string[] = [];
    for (const s of steps) {
      if (s.kind === "goto") {
        await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 15000 });
      } else if (s.kind === "fill") {
        await page.locator(s.selector).fill(s.value);
      } else if (s.kind === "click") {
        await page.locator(s.selector).click();
        await page.waitForLoadState("domcontentloaded");
      } else {
        const snap = await page.locator("body").ariaSnapshot();
        parts.push(`# === page: ${s.label} (${page.url()}) ===\n${snap}`);
      }
    }
    return parts.join("\n\n");
  } finally {
    if (browser) await browser.close();
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message.split("\n")[0] ?? e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function captureSnapshot(url: string): Promise<string> {
  // Playwright deprecated page.accessibility.snapshot() in favor of
  // Locator.ariaSnapshot() (1.40+). The latter returns a YAML-ish string
  // already, so we use it directly and skip our own flattening.
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    return await page.locator("body").ariaSnapshot();
  } finally {
    if (browser) await browser.close();
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const usingFlow = args.flow.length > 0;
  let yaml: string;
  try {
    yaml = usingFlow ? await captureFlow(parseFlow(args.flow)) : await captureSnapshot(args.url);
  } catch (e: unknown) {
    process.stderr.write(`::error::dom-snapshot: capture failed (${usingFlow ? "flow" : args.url}) — ${describeError(e)}\n`);
    process.exit(1);
  }
  if (!yaml || yaml.trim().length === 0) {
    process.stderr.write(`::warning::dom-snapshot: accessibility tree was empty for ${args.url}\n`);
  }
  const tokens = estimateTokens(yaml);
  mkdirSync(dirname(args.output), { recursive: true });
  const header = [
    `# Accessibility snapshot — Phase 6 DOM grounding`,
    usingFlow ? `# Flow (multi-page): ${args.flow}` : `# URL: ${args.url}`,
    `# Captured: ${new Date().toISOString()}`,
    `# Estimated tokens: ~${tokens}`,
    `# Format: YAML-ish flattened a11y tree; lists past 10 items collapse.`,
    ``,
  ].join("\n");
  writeFileSync(args.output, header + yaml + "\n");
  process.stdout.write(
    `dom-snapshot: wrote ${args.output} (~${tokens} tokens)\n`,
  );
  if (tokens > args.maxTokens) {
    process.stderr.write(
      `::warning::dom-snapshot: ${tokens} tokens > ${args.maxTokens} cap. Downstream stages may label PR 'dom-probe:oversized'.\n`,
    );
    process.exit(2);
  }
  process.exit(0);
}

await main();
