#!/usr/bin/env node
/**
 * rag-map3-evaluator.test.ts — regression coverage for the Phase 1
 * retrieval-quality verdict (ADR-0001 §6 exit criterion: held-out MAP@3 >= 0.6).
 * Pins the inclusive PASS boundary, the HOLD band just below it, and the
 * insufficient-data override that fires regardless of MAP.
 *
 * Run:  npx tsx --test scripts/rag-map3-evaluator.test.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { buildQueryFromDoc, deriveVerdict } from "./rag-map3-evaluator.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const EVALUATOR = join(REPO_ROOT, "scripts", "rag-map3-evaluator.ts");
const EXAMPLES_DIR = join(REPO_ROOT, "examples");

interface CliArgsLike {
  k: number;
  minQueries: number;
  json: boolean;
  quiet: boolean;
  gate: boolean;
}

const args = (overrides: Partial<CliArgsLike> = {}): CliArgsLike => ({
  k: 3,
  minQueries: 5,
  json: false,
  quiet: true,
  gate: false,
  ...overrides,
});

/** A corpus where every dir has a UNIQUE framework + disjoint KB-IDs, so no doc
 * is relevant to any other → MAP 0 → HOLD. Used to exercise the gate. */
function writeHoldCorpus(root: string): void {
  const specs = [
    { dir: "alpha", fw: "bad-playwright", kb: "KB-9.1.1" },
    { dir: "beta", fw: "cypress", kb: "KB-9.2.2" },
    { dir: "gamma", fw: "selenium-java", kb: "KB-9.3.3" },
  ];
  for (const s of specs) {
    const d = join(root, s.dir);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "expected-plan.md"), `## Source framework\n${s.fw}\n\n| ${s.kb} | x |\n`);
    writeFileSync(join(d, "input.spec.ts"), "const a = 1;\n"); // no fingerprintable pattern
  }
}

test("deriveVerdict: MAP exactly at the 0.6 threshold is PASS (inclusive)", () => {
  const { verdict } = deriveVerdict(0.6, 8, args());
  assert.equal(verdict, "PASS");
});

test("deriveVerdict: MAP just below threshold is HOLD", () => {
  const { verdict } = deriveVerdict(0.599, 8, args());
  assert.equal(verdict, "HOLD");
});

test("deriveVerdict: too few queries is INSUFFICIENT-DATA even with high MAP", () => {
  // count (4) < minQueries (5) overrides the otherwise-passing MAP of 0.95.
  const { verdict } = deriveVerdict(0.95, 4, args({ minQueries: 5 }));
  assert.equal(verdict, "INSUFFICIENT-DATA");
});

// ---- 1F: the query must NOT leak the gold plan's KB-IDs (train/test leak).

test("buildQueryFromDoc: earns KB tokens from the input, never leaks gold-plan KB-IDs", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-q-"));
  try {
    const inputPath = join(root, "input.cy.js");
    // cy.intercept earns KB-1.2.11 via the production fingerprint catalogue.
    writeFileSync(inputPath, "cy.intercept('GET', '/api/x', {}).as('x');\ncy.visit('/');\n");
    // The gold plan cites KB-1.2.39 — an ID the fingerprint catalogue cannot
    // produce. isRelevant scores on shared KB-IDs, so this MUST NOT appear.
    const query = buildQueryFromDoc({
      id: "examples/q",
      inputPath,
      framework: "cypress",
      kbIds: new Set(["KB-1.2.39", "KB-1.2.40"]),
      bodyTokens: [],
    });
    const lower = query.map((t) => t.toLowerCase());
    assert.ok(lower.includes("kb-1.2.11"), "earns the fingerprint KB-ID from cy.intercept");
    assert.ok(lower.includes("cypress"), "carries the framework token");
    assert.ok(!lower.includes("kb-1.2.39"), "must NOT leak the gold-plan-only KB-1.2.39");
    assert.ok(!lower.includes("kb-1.2.40"), "must NOT leak the gold-plan-only KB-1.2.40");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- 1E: the --gate flag mirrors the CI gate (HOLD fails, else passes).

test("--gate exits non-zero on a HOLD corpus, exit 0 without --gate (opt-in)", () => {
  const root = mkdtempSync(join(tmpdir(), "pwm-gate-"));
  try {
    writeHoldCorpus(root);
    const env = { ...process.env, RAG_MAP3_EXAMPLES_DIR: root };
    const base = ["tsx", EVALUATOR, "--quiet", "--min-queries", "1"];
    const gated = spawnSync("npx", [...base, "--gate"], { cwd: REPO_ROOT, encoding: "utf8", env });
    assert.equal(gated.status, 1, "HOLD + --gate must exit 1");
    assert.match(`${gated.stderr ?? ""}`, /GATE FAIL/);
    const ungated = spawnSync("npx", base, { cwd: REPO_ROOT, encoding: "utf8", env });
    assert.equal(ungated.status, 0, "HOLD without --gate stays signal-only (exit 0)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--gate exits 0 on the real PASS corpus", () => {
  const env = { ...process.env, RAG_MAP3_EXAMPLES_DIR: EXAMPLES_DIR };
  const r = spawnSync("npx", ["tsx", EVALUATOR, "--gate", "--quiet"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(r.status, 0, "the golden corpus is PASS, so --gate exits 0");
});
