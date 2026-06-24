#!/usr/bin/env tsx
/**
 * assertion-coverage.ts — source-equivalence gate (audit: no-source-equivalence-gate).
 *
 * Nothing checked that a migration asserts the SAME behavior as the source:
 * ASSERTION_FLOOR=1 only proved "not a silent no-op", and the envelope's
 * `scenarios[].expectedAssertions` (the plan's checklist of intended assertions,
 * derived FROM the source) was declared and NEVER read. So a migration that
 * drops, weakens, or mis-targets an assertion auto-shipped.
 *
 * This reads `scenarios[].expectedAssertions` and checks each is REFLECTED in the
 * emitted tree (spec + POMs). Matching is deliberately LENIENT (token-overlap on
 * the distinctive literal anchors — quoted text / regex bodies) so a correct
 * GENERALISATION (e.g. dropping a dynamic name from `welcome back, jane` →
 * `/welcome back/i`) is NOT flagged; only an assertion whose anchors are largely
 * ABSENT from the output is reported as a coverage gap.
 *
 *   npx tsx scripts/assertion-coverage.ts --envelope <env.json> --output <spec|dir> [--strict]
 *
 * Exit codes: 0 = all checkable assertions covered (or --strict off); 1 = a gap
 * under --strict; 2 = usage / unreadable envelope.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { collectEmittedSources, collectEmittedFiles } from "./evaluate.js";
import { findGeneratedSpec } from "./output-spec.js";

interface Scenario {
  id?: string;
  title?: string;
  expectedAssertions?: string[];
}
interface Envelope {
  inputBasename?: string;
  scenarios?: Scenario[];
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "after", "before", "is", "are", "be",
  "to", "of", "on", "in", "a", "an", "it", "its", "as", "matches", "match", "shows",
  "show", "visible", "text", "value", "should", "displayed", "appears",
]);

/** Distinctive literal anchors from an expectedAssertion: quoted strings + regex bodies. */
function literalAnchors(assertion: string): string[] {
  const anchors: string[] = [];
  for (const m of assertion.matchAll(/'([^']+)'|"([^"]+)"/g)) anchors.push(m[1] ?? m[2] ?? "");
  for (const m of assertion.matchAll(/\/((?:[^/\\\n]|\\.)+)\/[a-z]*/g)) anchors.push(m[1] ?? "");
  return anchors.filter((a) => a.trim().length > 0);
}

function tokens(s: string, minLen = 3): string[] {
  return s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length >= minLen && !STOPWORDS.has(t));
}

export interface AssertionVerdict {
  assertion: string;
  scenario: string;
  checkable: boolean;
  covered: boolean;
  matchedFraction: number;
}

/** Coverage of one expectedAssertion against the normalized emitted source. */
export function coverAssertion(assertion: string, scenario: string, normalizedTree: string, squashedTree: string): AssertionVerdict {
  const anchors = literalAnchors(assertion);
  // Distinctive tokens come from the literal anchors (values, so len>=2, e.g. a
  // price "42"); a bare intent ("greeting is visible") has no anchor and is not
  // checkable — we don't flag what we can't verify.
  const distinctive = [...new Set(anchors.flatMap((a) => tokens(a, 2)))];
  const checkable = anchors.length > 0 && distinctive.length > 0;
  if (!checkable) return { assertion, scenario, checkable: false, covered: true, matchedFraction: 1 };
  const present = distinctive.filter((t) => normalizedTree.includes(t) || squashedTree.includes(t)).length;
  const matchedFraction = present / distinctive.length;
  return { assertion, scenario, checkable: true, covered: matchedFraction >= 0.5, matchedFraction };
}

export interface CoverageReport {
  total: number;
  checkable: number;
  covered: number;
  gaps: AssertionVerdict[];
}

export function assertionCoverage(envelope: Envelope, emittedSource: string): CoverageReport {
  const normalized = emittedSource.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ");
  const squashed = emittedSource.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
  const verdicts: AssertionVerdict[] = [];
  for (const sc of envelope.scenarios ?? []) {
    for (const a of sc.expectedAssertions ?? []) {
      verdicts.push(coverAssertion(a, sc.id ?? sc.title ?? "?", normalized, squashed));
    }
  }
  const checkable = verdicts.filter((v) => v.checkable);
  return {
    total: verdicts.length,
    checkable: checkable.length,
    covered: checkable.filter((v) => v.covered).length,
    gaps: checkable.filter((v) => !v.covered),
  };
}

function resolveSpec(output: string, inputBasename: string | undefined): string | null {
  if (!existsSync(output)) return null;
  if (statSync(output).isDirectory()) {
    return inputBasename ? findGeneratedSpec(output, inputBasename) : null;
  }
  return output;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      envelope: { type: "string" },
      output: { type: "string" },
      strict: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.envelope || !values.output) {
    process.stderr.write("Usage: assertion-coverage --envelope <env.json> --output <spec|dir> [--strict]\n");
    process.exit(2);
  }
  let env: Envelope;
  try {
    env = JSON.parse(readFileSync(values.envelope, "utf8")) as Envelope;
  } catch (e) {
    process.stderr.write(`::error::assertion-coverage: cannot read envelope ${values.envelope}: ${String(e)}\n`);
    process.exit(2);
  }
  const spec = resolveSpec(values.output, env.inputBasename);
  if (!spec) {
    process.stderr.write(`::warning::assertion-coverage: no spec resolved under ${values.output} — skipping\n`);
    process.exit(0);
  }
  const emitted = collectEmittedSources(spec);
  const filesProbed = collectEmittedFiles(spec).length;
  const rep = assertionCoverage(env, emitted);

  const pct = rep.checkable === 0 ? 100 : Math.round((rep.covered / rep.checkable) * 100);
  process.stdout.write(
    `assertion-coverage: ${rep.covered}/${rep.checkable} checkable assertion(s) reflected in the emitted tree ` +
      `(${pct}%, across ${filesProbed} file(s); ${rep.total - rep.checkable} intent-only assertion(s) skipped).\n`,
  );
  for (const g of rep.gaps) {
    process.stderr.write(
      `::warning::assertion gap [${g.scenario}]: "${g.assertion}" — only ${(g.matchedFraction * 100).toFixed(0)}% of its ` +
        `anchor tokens appear in the output. The source asserts this; the migration may have dropped or weakened it.\n`,
    );
  }
  if (values.strict && rep.gaps.length > 0) {
    process.stderr.write(`::error::assertion-coverage (--strict): ${rep.gaps.length} source assertion(s) not reflected in the output.\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
