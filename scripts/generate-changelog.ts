#!/usr/bin/env tsx
/**
 * generate-changelog.ts — auto-update CHANGELOG.md from merged PR history.
 *
 * Closes ROADMAP item G ("CHANGELOG auto-update generator").
 *
 * # Why
 *
 * CHANGELOG.md has been hand-curated since the repo was scaffolded
 * (Keep-a-Changelog format, see top of CHANGELOG.md). With 90+ PRs merged
 * after v0.2.0, the manual maintenance cost outgrew the value of bespoke
 * per-PR prose. This script regenerates a deterministic "Unreleased" section
 * (and one section per tagged release, if any) from `gh pr list` data.
 *
 * # Categorisation rules
 *
 * PR titles are bucketed by their conventional-commit prefix:
 *
 *   prefix              -> bucket
 *   feat: / feat(...)   -> Features
 *   fix:  / fix(...)    -> Fixes
 *   chore:/ chore(...)  -> Chores
 *   docs: / docs(...)   -> Docs
 *   anything else       -> Other
 *
 * Match is anchored at the start of the title and case-insensitive. The
 * trailing `:` is required; `feat foo` (no colon) goes to Other. We do NOT
 * strip the prefix from the rendered title — the prefix is the author's
 * intent declaration and is more useful kept.
 *
 * # Versioning
 *
 *  - Tagged versions come from `gh release list` (`tagName` + `publishedAt`).
 *    PRs merged on or before each release's `publishedAt` go into that
 *    section; the rest are "Unreleased".
 *  - If `gh release list` returns no tags (current state, 2026-06-15), the
 *    whole history is rendered as one "Unreleased" block.
 *
 * # Idempotency
 *
 * The generated block is delimited by sentinel HTML comments:
 *
 *   <!-- AUTOGEN:CHANGELOG:START -->
 *   ...rendered sections...
 *   <!-- AUTOGEN:CHANGELOG:END -->
 *
 * `--write` mode finds the sentinels in CHANGELOG.md and replaces the
 * block between them. If the sentinels are missing, the new block is
 * inserted after the level-1 heading + intro paragraph (or appended to
 * the file if no level-1 heading exists). Re-running with `--write` over
 * an already up-to-date file is a no-op (exit 0, diagnostic to stderr).
 *
 * The hand-curated prose ABOVE the START sentinel and BELOW the END
 * sentinel is preserved verbatim. To keep the v0.2.0 / v0.1.x narrative
 * untouched, leave it outside the sentinels.
 *
 * # CLI
 *
 *   npx tsx scripts/generate-changelog.ts             # stdout
 *   npx tsx scripts/generate-changelog.ts --write     # in-place update
 *   npx tsx scripts/generate-changelog.ts --since 50  # only PRs > #50
 *
 * # Workflow integration
 *
 * `.github/workflows/changelog-update.yml` runs this nightly (cron) and on
 * every closed-merged PR. The workflow commits any diff to a long-lived
 * branch `chore/changelog-update` and opens (or updates) a PR labeled
 * `chore:changelog`. Re-runs reuse the same branch + PR; the human-merge
 * step is the only manual interaction.
 *
 * Strict TS, no any.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

type Bucket = "Features" | "Fixes" | "Chores" | "Docs" | "Other";

interface MergedPr {
  number: number;
  title: string;
  mergedAt: string;
  labels: Array<{ name: string }>;
}

interface ReleaseRow {
  tagName: string;
  name: string;
  publishedAt: string;
}

interface VersionSection {
  heading: string;
  prs: MergedPr[];
}

interface CliArgs {
  write: boolean;
  since: number | null;
}

const BUCKET_ORDER: Bucket[] = ["Features", "Fixes", "Chores", "Docs", "Other"];
const SENTINEL_START = "<!-- AUTOGEN:CHANGELOG:START -->";
const SENTINEL_END = "<!-- AUTOGEN:CHANGELOG:END -->";
const CHANGELOG_PATH = resolve(process.cwd(), "CHANGELOG.md");
const GH_LIMIT = 100;

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      write: { type: "boolean", default: false },
      since: { type: "string" },
    },
    strict: true,
  });
  const since = typeof values.since === "string" ? Number.parseInt(values.since, 10) : NaN;
  if (typeof values.since === "string" && Number.isNaN(since)) {
    process.stderr.write(`error: --since expects an integer PR number, got ${values.since}\n`);
    process.exit(2);
  }
  return {
    write: values.write === true,
    since: Number.isFinite(since) ? since : null,
  };
}

function runGh(args: string[]): string {
  try {
    return execSync(`gh ${args.join(" ")}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`gh CLI failed: gh ${args.join(" ")}\n${message}\n`);
    process.exit(1);
  }
}

function fetchMergedPrs(since: number | null): MergedPr[] {
  const raw = runGh([
    "pr",
    "list",
    "--state",
    "merged",
    "--limit",
    String(GH_LIMIT),
    "--json",
    "number,title,mergedAt,labels",
  ]);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    process.stderr.write("gh pr list did not return an array\n");
    process.exit(1);
  }
  const prs: MergedPr[] = parsed.map((row) => {
    const r = row as Record<string, unknown>;
    const labels = Array.isArray(r.labels)
      ? (r.labels as Array<Record<string, unknown>>).map((l) => ({
          name: typeof l.name === "string" ? l.name : "",
        }))
      : [];
    return {
      number: typeof r.number === "number" ? r.number : 0,
      title: typeof r.title === "string" ? r.title : "",
      mergedAt: typeof r.mergedAt === "string" ? r.mergedAt : "",
      labels,
    };
  });
  const filtered = since == null ? prs : prs.filter((pr) => pr.number > since);
  // Newest first — already the gh default but enforce for determinism.
  filtered.sort((a, b) => b.number - a.number);
  return filtered;
}

function fetchReleases(): ReleaseRow[] {
  const raw = runGh(["release", "list", "--limit", "50", "--json", "tagName,name,publishedAt"]);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const rows: ReleaseRow[] = parsed.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      tagName: typeof r.tagName === "string" ? r.tagName : "",
      name: typeof r.name === "string" ? r.name : "",
      publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : "",
    };
  });
  // Newest release first.
  rows.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return rows;
}

function bucketFor(title: string): Bucket {
  const head = title.trimStart().toLowerCase();
  if (/^feat(\([^)]*\))?:/.test(head)) return "Features";
  if (/^fix(\([^)]*\))?:/.test(head)) return "Fixes";
  if (/^chore(\([^)]*\))?:/.test(head)) return "Chores";
  if (/^docs(\([^)]*\))?:/.test(head)) return "Docs";
  return "Other";
}

function groupSections(prs: MergedPr[], releases: ReleaseRow[]): VersionSection[] {
  if (releases.length === 0) {
    return [{ heading: "## [Unreleased]", prs }];
  }
  // Releases are newest-first. Each PR slots into the newest release whose
  // publishedAt is >= mergedAt; PRs newer than the newest release go into Unreleased.
  const sections: VersionSection[] = [{ heading: "## [Unreleased]", prs: [] }];
  for (const release of releases) {
    const date = release.publishedAt.slice(0, 10);
    sections.push({
      heading: `## [${release.tagName}]${release.name && release.name !== release.tagName ? ` — ${release.name}` : ""} — ${date}`,
      prs: [],
    });
  }
  for (const pr of prs) {
    let placed = false;
    for (let i = releases.length - 1; i >= 0; i -= 1) {
      const release = releases[i];
      if (release && pr.mergedAt <= release.publishedAt) {
        const target = sections[i + 1];
        if (target) {
          target.prs.push(pr);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      const unreleased = sections[0];
      if (unreleased) unreleased.prs.push(pr);
    }
  }
  return sections;
}

function renderBucket(bucket: Bucket, prs: MergedPr[]): string {
  if (prs.length === 0) return "";
  const lines = [`### ${bucket}`, ""];
  for (const pr of prs) {
    const date = pr.mergedAt.slice(0, 10);
    lines.push(`- ${pr.title} (#${pr.number}, ${date})`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderSection(section: VersionSection): string {
  const lines: string[] = [section.heading, ""];
  if (section.prs.length === 0) {
    lines.push("_No merged PRs in this range._", "");
    return lines.join("\n");
  }
  const byBucket = new Map<Bucket, MergedPr[]>();
  for (const bucket of BUCKET_ORDER) byBucket.set(bucket, []);
  for (const pr of section.prs) {
    const arr = byBucket.get(bucketFor(pr.title));
    if (arr) arr.push(pr);
  }
  for (const bucket of BUCKET_ORDER) {
    const rendered = renderBucket(bucket, byBucket.get(bucket) ?? []);
    if (rendered) lines.push(rendered);
  }
  return lines.join("\n");
}

function renderBlock(sections: VersionSection[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    SENTINEL_START,
    "",
    `<!-- Generated by scripts/generate-changelog.ts on ${stamp}. -->`,
    "<!-- Do not edit between the sentinels by hand — re-run the script. -->",
    "",
  ];
  for (const section of sections) {
    lines.push(renderSection(section));
  }
  lines.push(SENTINEL_END);
  return lines.join("\n");
}

function spliceIntoChangelog(existing: string, block: string): string {
  const startIdx = existing.indexOf(SENTINEL_START);
  const endIdx = existing.indexOf(SENTINEL_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + SENTINEL_END.length);
    return `${before.replace(/\s+$/, "")}\n\n${block}\n${after.replace(/^\s+/, "\n\n")}`;
  }
  // No sentinels yet — insert after the first level-1 heading + its intro,
  // before the first level-2 heading. Falls back to appending if no level-2.
  const headingMatch = /^# .+$/m.exec(existing);
  if (!headingMatch) {
    return `${existing.trimEnd()}\n\n${block}\n`;
  }
  const afterHeading = existing.slice(headingMatch.index + headingMatch[0].length);
  const firstSection = afterHeading.indexOf("\n## ");
  if (firstSection === -1) {
    return `${existing.trimEnd()}\n\n${block}\n`;
  }
  const splitAt = headingMatch.index + headingMatch[0].length + firstSection;
  const before = existing.slice(0, splitAt);
  const after = existing.slice(splitAt);
  return `${before.replace(/\s+$/, "")}\n\n${block}\n${after.replace(/^\s+/, "\n\n")}`;
}

function main(): void {
  const args = parseCli();
  const prs = fetchMergedPrs(args.since);
  const releases = fetchReleases();
  const sections = groupSections(prs, releases);
  const block = renderBlock(sections);

  if (!args.write) {
    process.stdout.write(`${block}\n`);
    return;
  }
  if (!existsSync(CHANGELOG_PATH)) {
    process.stderr.write(`error: ${CHANGELOG_PATH} not found\n`);
    process.exit(1);
  }
  const existing = readFileSync(CHANGELOG_PATH, "utf8");
  const updated = spliceIntoChangelog(existing, block);
  if (updated === existing) {
    process.stderr.write("CHANGELOG.md already up to date — no changes written.\n");
    return;
  }
  writeFileSync(CHANGELOG_PATH, updated, "utf8");
  process.stderr.write(`CHANGELOG.md updated (${prs.length} merged PR(s) across ${sections.length} section(s)).\n`);
}

main();
