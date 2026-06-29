#!/usr/bin/env tsx
/** Unit coverage for the cross-migration POM-contamination gate (DEF2) pure core. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractPlanRefs, findProvenanceIssues } from "./validate-pom-provenance.js";

test("extractPlanRefs: collects distinct plan refs; scaffolding (no header) → none", () => {
  assert.deepEqual(extractPlanRefs("// See outputs/plans/saucedemo-login.cy.js.md for plan and rationale."), ["saucedemo-login.cy.js.md"]);
  assert.deepEqual(extractPlanRefs("import { BasePage } from '@page-object/basepage';\nexport class X {}"), []);
  assert.deepEqual(
    extractPlanRefs("// See outputs/plans/a.md\n// ...later...\n// See outputs/plans/b.md").sort((a, b) => a.localeCompare(b)),
    ["a.md", "b.md"],
  );
});

test("findProvenanceIssues: a single-owner POM is CLEAN (incl. legitimate reuse by another spec)", () => {
  // The whole point: a POM authored by ONE migration but reused by other specs is
  // NOT contamination. Only >1 distinct plan IN the file is.
  assert.deepEqual(findProvenanceIssues([
    { path: "login.page.ts", planRefs: ["login.cy.js.md"] },
    { path: "basepage.ts", planRefs: [] }, // scaffolding
  ]), []);
});

test("findProvenanceIssues: CO-AUTHORED — a single POM carries >1 distinct plan → flagged", () => {
  const issues = findProvenanceIssues([{ path: "login.page.ts", planRefs: ["a.md", "b.md"] }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.kind, "co-authored");
  assert.match(issues[0]?.detail ?? "", /a\.md, b\.md/);
});
