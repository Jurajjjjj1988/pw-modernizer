#!/usr/bin/env tsx
/**
 * Unit tests for the basename-scoped Stage-2 spec resolver (output-spec.ts).
 * Pins the fix for "CI scores the WRONG spec": on a flat tree holding several
 * merged migrations, the resolver must return the one matching the current
 * input — never the lexically-first — and handle cross-language renames.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

import { expectedSpecBasenames, listOutputSpecs, findGeneratedSpec } from "./output-spec.js";

function treeWith(specs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "outspec-"));
  for (const s of specs) {
    const full = join(dir, s);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "// spec\n");
  }
  return dir;
}

test("expectedSpecBasenames maps cross-language + kebab + test-suffix forms", () => {
  // `Test`/`-test`/`_test` suffix yields BOTH the literal kebab and the dropped form.
  assert.ok(expectedSpecBasenames("EmployeesTest.java").includes("employees.spec.ts"));
  assert.ok(expectedSpecBasenames("force-clicks.spec.ts").includes("force-clicks.spec.ts"));
  assert.ok(expectedSpecBasenames("login_test.py").includes("login.spec.ts"));
});

test("findGeneratedSpec returns the basename match, NOT the lexically-first spec", () => {
  // 'force-clicks' sorts first; the resolver must still return nth-selectors for that input.
  const dir = treeWith(["force-clicks.spec.ts", "nth-selectors.spec.ts", "search-filters.spec.ts"]);
  try {
    const got = findGeneratedSpec(dir, "nth-selectors.spec.ts");
    assert.equal(basename(got ?? ""), "nth-selectors.spec.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findGeneratedSpec resolves a cross-language rename (Java input → kebab spec)", () => {
  const dir = treeWith(["force-clicks.spec.ts", "employees.spec.ts"]);
  try {
    const got = findGeneratedSpec(dir, "EmployeesTest.java");
    assert.equal(basename(got ?? ""), "employees.spec.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findGeneratedSpec falls back to the lexically-first spec when no basename match", () => {
  const dir = treeWith(["alpha.spec.ts", "zeta.spec.ts"]);
  try {
    assert.equal(basename(findGeneratedSpec(dir, "unrelated-input.spec.ts") ?? ""), "alpha.spec.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findGeneratedSpec returns null for an empty / missing tree; listOutputSpecs skips the v0.1.x archive", () => {
  assert.equal(findGeneratedSpec(join(tmpdir(), "does-not-exist-outspec"), "x.spec.ts"), null);
  const dir = treeWith(["keep.spec.ts", "_legacy-v0.1.x/old.spec.ts"]);
  try {
    const specs = listOutputSpecs(dir).map((s) => basename(s));
    assert.deepEqual(specs, ["keep.spec.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
