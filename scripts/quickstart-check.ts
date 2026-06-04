#!/usr/bin/env tsx
/**
 * One-shot local check that PWmodernizer is set up correctly.
 *
 * Runs all the same gates CI runs, in the same order, with explanations of
 * what each one means. Suitable for first-time contributors. Use 'npm run
 * smoke' for the silent CI-equivalent.
 *
 * CLI: npx tsx scripts/quickstart-check.ts
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

interface Step {
  label: string;
  cmd: string;
  hint: string;
}

const steps: Step[] = [
  {
    label: "Node version",
    cmd: "node --version",
    hint: "PWmodernizer requires Node 22+. If yours is older, install nvm/fnm and 'nvm install 22'.",
  },
  {
    label: "Dependencies installed",
    cmd: "node -e \"require('ts-morph');require('ajv')\"",
    hint: "Run 'npm ci' first.",
  },
  {
    label: "TypeScript: scripts/ + tools/",
    cmd: "npx tsc --noEmit -p tsconfig.json",
    hint: "Type errors in scripts/. Fix them; the validators run via tsx and need strict types.",
  },
  {
    label: "TypeScript: outputs/tests/",
    cmd: "npx tsc --noEmit -p outputs/tests/tsconfig.json",
    hint: "Type errors in outputs/tests/. Usually means a migrated test reused a removed POM/fixture or has stale types.",
  },
  {
    label: "KB IDs valid + referenced",
    cmd: "npx tsx scripts/kb-validate.ts",
    hint: "A KB-ID referenced from prompts/ or config/ doesn't exist in knowledge-base.md (or duplicates exist).",
  },
  {
    label: "Examples KB/Q-ID cross-refs (strict)",
    cmd: "npx tsx scripts/validate-examples.ts --strict",
    hint: "An expected-plan.md cites a KB-ID or Q-ID that doesn't resolve. See the Cleanlab pattern in README.",
  },
  {
    label: "Prompt fragments resolve",
    cmd: "npx tsx scripts/assemble-prompts.ts --check",
    hint: "A '{{include:_fragments/X.md}}' marker doesn't resolve. Either the file is missing or the path is wrong.",
  },
  {
    label: "Plan envelope schema sanity",
    cmd: "npx tsx scripts/plan-envelope-validate.ts --envelope examples/bad-playwright-01-flaky-waits/expected-plan.envelope.json",
    hint: "The canonical envelope example doesn't match its schema. Either the schema or the example drifted.",
  },
  {
    label: "Derive-envelope roundtrip (12 example plans)",
    cmd: "npm run check:derive --silent",
    hint: "scripts/derive-envelope.ts can't parse some example plan into a schema-valid envelope. Either the plan markdown drifted from §9 schema or the derive parser needs updating.",
  },
  {
    label: "Validators calibrated (24 fixtures)",
    cmd: "npx tsx tools/calibrate-pipeline/run-calibration.ts",
    hint: "A validator accepted a bad fixture or rejected a good one. Calibration is required before promoting --warn → --strict per Sakasegawa 2026.",
  },
];

let passed = 0;
let failed = 0;
for (const step of steps) {
  process.stdout.write(`  ${step.label} ... `);
  try {
    execSync(step.cmd, { stdio: "pipe" });
    process.stdout.write("OK\n");
    passed += 1;
  } catch (err) {
    process.stdout.write("FAIL\n");
    console.error(`    hint: ${step.hint}`);
    const msg = err instanceof Error ? err.message : String(err);
    const lines = msg.split("\n").slice(0, 5).join("\n      ");
    console.error(`    error excerpt:\n      ${lines}`);
    failed += 1;
  }
}

if (!existsSync("outputs/tests/playwright.config.ts")) {
  console.warn("  note: outputs/tests/playwright.config.ts missing — local 'npx playwright test' won't work until you pull main.");
}

console.log("");
console.log(`Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("Fix the failing checks before opening a PR. CI runs the same gates.");
  process.exit(1);
}
console.log("All checks green. You're ready to contribute.");
console.log("Next: drop a bad Playwright spec into inputs/bad-playwright/ and push to fire Stage 1.");
