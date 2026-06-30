/**
 * plan-code-coverage.test.ts — pins the json-guard-coverage hardening of
 * loadEnvelope.
 *
 * The defect: loadEnvelope did an unguarded `JSON.parse` followed by a blind
 * `as Envelope` cast. A truncated/malformed envelope crashed with a raw
 * SyntaxError, and an envelope missing the `scenarios`/`requiredPOMs`/
 * `requiredFixtures` arrays crashed later inside a validator's `.map`/`for…of`
 * — neither produced an actionable GitHub Actions annotation. The fix: parse
 * inside try/catch and assert Array.isArray on the three dereferenced fields,
 * throwing a typed EnvelopeLoadError so main() can emit
 * `::error file=<path>::…` + exit 1. Valid envelopes are returned identically.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadEnvelope, EnvelopeLoadError, type Envelope } from "./plan-code-coverage.js";

function withTmpFile(contents: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pwm-pcc-"));
  try {
    const path = join(dir, "envelope.json");
    writeFileSync(path, contents, "utf8");
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VALID_ENVELOPE = {
  inputBasename: "input.spec.ts",
  sourceFramework: "bad-playwright",
  subtractive: true,
  scenarios: [
    { id: "1.1", title: "valid login @positive", userAction: "submit", expectedAssertions: ["dashboard"] },
  ],
  requiredPOMs: [],
  requiredFixtures: [],
};

test("loadEnvelope: valid envelope is returned identically (additive — no behaviour change)", () => {
  withTmpFile(JSON.stringify(VALID_ENVELOPE), (path) => {
    const env: Envelope = loadEnvelope(path);
    assert.equal(env.inputBasename, "input.spec.ts");
    assert.equal(env.scenarios.length, 1);
    assert.equal(env.scenarios[0]?.id, "1.1");
    assert.deepEqual(env.requiredPOMs, []);
    assert.deepEqual(env.requiredFixtures, []);
  });
});

test("loadEnvelope: malformed JSON throws EnvelopeLoadError, not a raw SyntaxError", () => {
  withTmpFile('{ "inputBasename": "x.spec.ts", "scenarios": [', (path) => {
    assert.throws(
      () => loadEnvelope(path),
      (err: unknown) => err instanceof EnvelopeLoadError && /not valid JSON/.test(err.message),
    );
  });
});

test("loadEnvelope: missing scenarios array throws EnvelopeLoadError naming the field", () => {
  const noScenarios = { ...VALID_ENVELOPE };
  delete (noScenarios as Record<string, unknown>).scenarios;
  withTmpFile(JSON.stringify(noScenarios), (path) => {
    assert.throws(
      () => loadEnvelope(path),
      (err: unknown) => err instanceof EnvelopeLoadError && /scenarios/.test(err.message),
    );
  });
});

test("loadEnvelope: scenarios present but not an array throws EnvelopeLoadError", () => {
  const wrongType = { ...VALID_ENVELOPE, scenarios: "1.1" };
  withTmpFile(JSON.stringify(wrongType), (path) => {
    assert.throws(
      () => loadEnvelope(path),
      (err: unknown) => err instanceof EnvelopeLoadError && /scenarios/.test(err.message),
    );
  });
});

test("loadEnvelope: missing requiredFixtures array throws EnvelopeLoadError naming the field", () => {
  const noFixtures = { ...VALID_ENVELOPE };
  delete (noFixtures as Record<string, unknown>).requiredFixtures;
  withTmpFile(JSON.stringify(noFixtures), (path) => {
    assert.throws(
      () => loadEnvelope(path),
      (err: unknown) => err instanceof EnvelopeLoadError && /requiredFixtures/.test(err.message),
    );
  });
});

test("loadEnvelope: a top-level JSON array (not object) throws EnvelopeLoadError", () => {
  withTmpFile("[]", (path) => {
    assert.throws(
      () => loadEnvelope(path),
      (err: unknown) => err instanceof EnvelopeLoadError && /not a JSON object/.test(err.message),
    );
  });
});
