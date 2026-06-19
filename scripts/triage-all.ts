#!/usr/bin/env node
/**
 * triage-all.ts — the second token saving: digest EVERY open migrator PR into
 * one compact view so debugging starts from ~20-line digests, never raw CI logs.
 * ZERO Claude tokens.
 *
 * Pairs with capture-failure.ts (npm run triage <pr#>, single PR). This walks
 * all open migrator:* PRs, runs the per-PR triage, and writes a combined
 * summary table + every DIGEST under _captured/INDEX.md. Read INDEX.md instead
 * of opening workflow logs — that is the whole point.
 *
 * Run:
 *   npx tsx scripts/triage-all.ts            # all open migrator PRs
 *   npx tsx scripts/triage-all.ts --code     # only migrator:code PRs
 *
 * Exit codes: 0 always (reporting tool; per-PR failures are noted, not fatal).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CAPTURE_ROOT = join(
  REPO_ROOT, "tools", "calibrate-pipeline", "fixtures", "_captured",
);

interface PrRow {
  pr: number;
  title: string;
  verdict: string;
  anomalies: string[];
  digest: string;
}

function parseCliArgs(): { codeOnly: boolean } {
  const { values } = parseArgs({ options: { code: { type: "boolean", default: false } } });
  return { codeOnly: values.code === true };
}

/** Open migrator PR numbers, optionally only migrator:code. */
function listMigratorPrs(codeOnly: boolean): number[] {
  const jq = codeOnly
    ? '.[] | select(any(.labels[].name; . == "migrator:code")) | .number'
    : '.[] | select(any(.labels[].name; startswith("migrator:"))) | .number';
  const res = spawnSync(
    "gh",
    ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,labels", "--jq", jq],
    { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    console.error(`gh pr list failed:\n${res.stderr ?? ""}`);
    return [];
  }
  return res.stdout.split("\n").map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

/** Run the single-PR triage and return its printed digest, or null on failure. */
function triageOne(pr: number): string | null {
  const res = spawnSync(
    "npx",
    ["tsx", "scripts/capture-failure.ts", String(pr)],
    { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
  );
  if (res.status !== 0) return null;
  return res.stdout;
}

/** Pull the `- verdict: **X**` value out of a digest. */
function verdictOf(digest: string): string {
  const m = /verdict:\s*\*\*([^*]+)\*\*/.exec(digest);
  return m?.[1]?.trim() ?? "?";
}

/** Pull `- [kind] ...` anomaly kinds out of a digest. */
function anomaliesOf(digest: string): string[] {
  const out: string[] = [];
  for (const line of digest.split("\n")) {
    const m = /^- \[([a-z-]+)\]/.exec(line.trim());
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/** Short title from the digest's first bullet. */
function titleOf(digest: string): string {
  const m = /^- (\[Migration[^\n]+)/m.exec(digest);
  return m?.[1]?.trim() ?? "";
}

function main(): void {
  const { codeOnly } = parseCliArgs();
  const prs = listMigratorPrs(codeOnly);
  mkdirSync(CAPTURE_ROOT, { recursive: true });

  const rows: PrRow[] = [];
  for (const pr of prs) {
    const digest = triageOne(pr);
    if (digest === null) {
      rows.push({ pr, title: "(triage failed)", verdict: "ERROR", anomalies: [], digest: "" });
      continue;
    }
    rows.push({
      pr,
      title: titleOf(digest),
      verdict: verdictOf(digest),
      anomalies: anomaliesOf(digest),
      digest,
    });
  }

  // Summary table — the compact view to read instead of logs.
  const header = [
    `# Triage index — ${rows.length} open migrator PR(s)`,
    "",
    "| PR | verdict | anomalies | title |",
    "|---|---|---|---|",
  ];
  const tableRows = rows.map((r) =>
    `| #${r.pr} | ${r.verdict} | ${[...new Set(r.anomalies)].join(", ") || "—"} | ${r.title} |`,
  );

  // Recurring-anomaly rollup: a kind seen on 2+ PRs hints at a deterministic gap.
  const counts = new Map<string, number[]>();
  for (const r of rows) {
    for (const k of new Set(r.anomalies)) {
      counts.set(k, [...(counts.get(k) ?? []), r.pr]);
    }
  }
  const recurring = [...counts.entries()].filter(([, prsForKind]) => prsForKind.length >= 2);
  const rollup = recurring.length
    ? ["", "## Recurring anomalies (2+ PRs → likely deterministic gap, not LLM variance)", "",
       ...recurring.map(([k, ps]) => `- **${k}** on ${ps.map((p) => `#${p}`).join(", ")}`)]
    : ["", "## Recurring anomalies", "", "- none — anomalies look PR-specific (LLM variance)"];

  const digests = ["", "---", "", "## Full digests", "",
    ...rows.filter((r) => r.digest).map((r) => `\`\`\`\n${r.digest}\n\`\`\``)];

  const doc = [...header, ...tableRows, ...rollup, ...digests].join("\n");
  const indexPath = join(CAPTURE_ROOT, "INDEX.md");
  writeFileSync(indexPath, doc);

  process.stdout.write([...header, ...tableRows, ...rollup, "", `Full digests → ${indexPath}`].join("\n") + "\n");
}

main();
