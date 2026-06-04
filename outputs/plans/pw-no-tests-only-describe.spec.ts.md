# Migration plan: pw-no-tests-only-describe.spec.ts

## Source framework

bad-playwright — subtractive migration, no framework translation required.

The source file imports `@playwright/test` and is syntactically valid Playwright TypeScript. However, it contains **zero `test()` invocations**. All three `test.describe` blocks are empty. This is a degenerate bad-playwright case: there is nothing to migrate, only infrastructure to delete.

> **Stage 2 blocker:** this plan cannot be executed until the reviewer resolves Q1–Q4 in the Open Questions section. Stage 2 must not be triggered until at least one of the following is true: (a) the reviewer has deleted this file, or (b) the reviewer has added `test()` call bodies to the describes and updated the plan's Scenarios accordingly.

---

## Summary

`pw-no-tests-only-describe.spec.ts` declares three `test.describe` blocks for "Acme Shop search", "Acme Shop checkout", and "Acme Shop profile" but every describe body is empty — each contains only a comment. The file also exports three non-test symbols (`RESOURCES`, `FLAGS`, `fakeHelper`) whose sole purpose, per the file's own inline comments, is to push file size above Stage 0's 200-byte floor and anchor the Playwright import. When executed by Playwright, this file produces **zero test results** — no passes, no failures, no skips. It silently provides no coverage.

### What bug does this catch?

**None.** There are no assertions and no `test()` calls. This file cannot catch any regression. Playwright reports "0 tests run" rather than a failure, which most CI configurations treat as a green pass — creating a silent coverage illusion for three feature areas (search, checkout, profile).

### User-perceivable assertion checklist

*(none — zero `test()` calls exist in the source file)*

---

## Anti-patterns detected

Severity codes: **H** = test will flake / break / leak secrets, **M** = test still works but is fragile or unreadable, **L** = stylistic.

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| H | 14 | KB-UNCLASSIFIED | empty-describe-no-tests | `test.describe('Acme Shop search', () => {…})` | Delete or fill with `test()` calls |
| H | 18 | KB-UNCLASSIFIED | empty-describe-no-tests | `test.describe('Acme Shop checkout', () => {…})` | Delete or fill with `test()` calls |
| H | 22 | KB-UNCLASSIFIED | empty-describe-no-tests | `test.describe('Acme Shop profile', () => {…})` | Delete or fill with `test()` calls |
| L | 29–30 | KB-UNCLASSIFIED | non-test-exports-in-spec | `export const RESOURCES = ['cart', ...]` | Delete; data constants → `data/*.ts` |
| L | 31–33 | KB-UNCLASSIFIED | tautology-export-fn | `return expect !== undefined` | Delete entirely |

### Unclassified smells

All five patterns above are KB-UNCLASSIFIED. Reviewer should confirm each and decide whether to open a catalog issue in `config/knowledge-base.md`.

**1. empty-describe-no-tests (lines 14, 18, 22)**
Each `test.describe` callback is an empty arrow function containing only a developer comment. No `test()`, `beforeEach`, `afterEach`, or any executable statement is present. `KB-1.1.15` (unnecessary `test.describe` nesting) is the closest catalog entry but covers the narrower case of describes that wrap a single child with tests present; this pattern is more severe — zero children. Playwright's runner reports "0 tests found" rather than an error, producing a silent coverage illusion. The file's own comment documents that Stage 0 incorrectly passes this file because its marker regex matches the word `describe` inside `test.describe(...)` lexically without confirming a `test()` call. **Reviewer action required**: either delete this file, or specify what each describe block should contain before Stage 2 can proceed.

**2. non-test-exports-in-spec (lines 29–30)**
`RESOURCES` and `FLAGS` are exported module-level constants that have no relationship to any test case. No describe, test, setup hook, or locator references them. They exist, per the file's own comment, solely to push file size above Stage 0's 200-byte floor. If test data constants are legitimately needed, they belong in `data/<feature>-fixtures.ts` per `migration-rules.md §1` (file naming and project structure).

**3. tautology-export-fn (lines 31–33)**
`fakeHelper(): boolean { return expect !== undefined; }` always returns `true`. Playwright's `expect` is always defined after a successful module import. This function is not a test assertion — it is a tautology that exists solely to prevent TypeScript from flagging `expect` as an unused import, and to further pad byte count. Should be deleted along with the export.

---

## Locator translation table

*(empty — the source file contains zero locators; no UI interactions exist anywhere in the file)*

| Original | New | Confidence | Notes |
|---|---|---|---|
| *(none)* | — | — | — |

---

## Hallucination-defense pins

N/A — all locators are HIGH confidence. (No locators exist in the source; the locator table is empty. There are no DOM assumptions for Stage 2 to make.)

---

## Structural changes

- **Extract POM:** no — no page interactions exist; `migration-rules.md §1` threshold of 200 LOC is not applicable when there are zero tests.
- **Extract fixture:** no — no setup or teardown code exists; the `migration-rules.md §1` fixture threshold (≥2 test files sharing setup) cannot be met by a file with zero tests.
- **Split into multiple specs:** no — recommended action is deletion, not splitting.
- **New data files:** none — see `non-test-exports-in-spec` smell above; `RESOURCES`/`FLAGS` have no test purpose and should be deleted, not promoted.
- **Recommended action — DELETE this file.** It produces zero tests and zero coverage. If the three describe-block names represent planned future tests, each should be addressed in a separate branch once the test scenarios are specified and Open Questions Q1–Q5 are answered by the reviewer.

---

## Open questions for reviewer

```
Q1: Should this file be deleted entirely?
Context: the file's own comment says "Task intent: REJECT" — it was created as a
  stress fixture to expose a Stage 0 detection gap, not as a real test scaffold.
What I assumed (proceeding without an answer): the file should be deleted; Stage 2
  should not run on it.
Impact if my assumption is wrong: Stage 2 would generate test boilerplate without any
  source evidence for what to assert, producing fabricated scenarios that are worse
  than no tests at all.
```

```
Q2: What should test.describe('Acme Shop search') contain?
Context: line 14 — empty describe block with comment "body intentionally empty."
What I assumed: no assumption; this is fully unresolved.
Impact if my assumption is wrong: any generated test would assert on fabricated
  user-perceivable behaviour with zero source evidence, producing hallucinated
  locators and assertions that will fail on first run.
```

```
Q3: What should test.describe('Acme Shop checkout') contain?
Context: line 18 — same situation as Q2.
What I assumed: no assumption.
Impact if my assumption is wrong: same as Q2.
```

```
Q4: What should test.describe('Acme Shop profile') contain?
Context: line 22 — same situation as Q2.
What I assumed: no assumption.
Impact if my assumption is wrong: same as Q2.
```

```
Q5: Are the three describe-block names intended coverage areas for a future suite,
  or are they orphaned scaffolding from a refactor that already moved tests elsewhere?
Context: the file comment says "Stage 0 stress fixture." The three feature names
  (search, checkout, profile) are plausible for an "Acme Shop" product, but there
  is no sibling file in inputs/ that houses the actual tests for these features.
What I assumed: this is intentional stress-fixture scaffolding and the names have no
  production coverage counterpart.
Impact if my assumption is wrong: if these are genuinely orphaned coverage gaps in a
  real product suite, deleting the file may hide that the search / checkout / profile
  features are untested.
```

```
Q6: Should the Stage 0 marker detection be patched to require at least one test()
  invocation in addition to describe / test.describe?
Context: the file's own comment documents this FIXME — the regex
  \b(test|it|describe|@Test|def test_|cy\.|page\.)\b matches the keyword `test`
  inside test.describe(...) without verifying a test() call is present. This is a
  known gap paralleling test-markers-in-comments-only.spec.ts.
What I assumed: this is a known pipeline FIXME outside the scope of this migration;
  the Stage 0 fix belongs in a separate issue, not in the generated output.
Impact if my assumption is wrong: without the fix, other skeleton files may silently
  pass Stage 0 and waste Stage 1 compute.
```

---

## Risk callouts

- **CI silent green pass.** Playwright reports "0 tests" without an error exit code. Most CI pipelines treat "0 tests, 0 failures" as a success. A team watching CI green-lights will never be alerted that search, checkout, and profile have no coverage.

- **Stage 0 marker detection gap (documented in the file itself).** The marker regex matches `test` and `describe` as keywords without confirming an actual `test()` call. This file is a legitimate regression test for that gap. The risk is that the gap goes unpatched and other empty-describe files are silently queued into the migration pipeline, consuming Stage 1 and Stage 2 tokens on non-migratable content.

- **Coverage percentage inflation.** If a coverage dashboard aggregates "files that ran" or "describe blocks registered," this file contributes three describe blocks to the count while providing zero assertion coverage. Metrics derived from this will over-report coverage for the Acme Shop product.

- **No behavioral drift risk specific to the migration.** Since the file contains no assertions, no page interactions, and no locators, there is no migration-specific behavioral drift to guard against. The only risk is structural: if Stage 2 is somehow triggered (against this plan's explicit blocker notice) and generates stub tests without proper assertions, those stubs will silently pass in CI and provide a false assurance of coverage.

- **No flake risk.** An empty test.describe cannot produce a flaky test — it cannot produce any test. Flake risk is irrelevant here.

---

## Expected metrics

- **Selector quality score (estimated post-migration):** 1.0 — N/A case; 0 locators in source, score defaults to 1.0
- **Smell count delta vs source:** −5 (3 × empty-describe-no-tests + 1 × non-test-exports + 1 × tautology-fn, all removed on deletion)
- **New test file LOC estimate:** 0 (file deleted) or indeterminate (if reviewer adds test bodies, scope is unknown)
- **Source file LOC:** ~33 lines
- **LOC delta:** −33 (entire file deleted; no output file produced)
- **Anti-pattern coverage:** 5/5 (all detected smells cataloged; none were missed)
