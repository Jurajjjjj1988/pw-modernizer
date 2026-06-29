# Defect hunt + best-practice research — findings & roadmap

A multi-agent adversarial hunt (6 lenses → verify → research) confirmed **24 real
pipeline defects**; a follow-on research swarm (7 agents, primary-source-verified)
produced implementable fixes for the hard classes. This is the actionable record.

## Fixed in this batch (committed)

| # | Defect | Fix | Status |
|---|---|---|---|
| DEF1 | **False-green family** — the execution verdict accepted a green when output merely contained "passed" and not "failed" with exit 0, so `1 passed, 2 skipped`, an all-skipped run, a flaky pass, an interrupted run, and even "passed" in a test title all passed as GREEN. | `parsePlaywrightVerdict` now parses the tally and requires `passedN≥1 AND failed/skipped/flaky/interrupted/didNotRun all 0 AND exit 0`. +6 regression tests. | ✅ committed |
| DEF2 | **Cross-app POM contamination** — batch/sequential migrations against different apps share-overwrite a shared POM; one migration's spec then references another app's locators, green by every static gate. | `validate-pom-provenance.ts` flags the UNAMBIGUOUS case (one POM carrying >1 distinct plan ref). The proposed "orphan" check was REJECTED after running it: it false-positives on legitimate qa-master reuse. Wired into the wall. | ✅ committed |
| IMP5 | Green-but-lint-dirty output reached acceptance (the repair loop only checked execution). | `ensureLintClean` runs after execution-green: bounded lint-repair, re-verifies execution; execution stays primary. | ✅ committed |
| IMP6 | At scale every test re-derives the same locators + repairs the same guess. | Per-app verified-locator cache (`locator-cache.ts`): records resolved-unique from the DOM-probe, injects "VERIFIED LOCATORS for <host>" into Stage-2. | ✅ committed |

**Process lesson reinforced:** an audit's proposed gate (DEF2 orphan check) was wrong; running it against the real corpus caught the false-positive before shipping. Verify, don't trust.

## Backlog — research-backed, ready to implement (prioritised)

### B1 — Assertion-strength gate (HIGH, deterministic) — closes the "weakened assertions accepted as green" class
The repair loop can make a test pass by WEAKENING an assertion (`toHaveText('3')`→`toBeVisible()`, dropping a `.not`, dropping an assert). Today only a prompt nudge + an advisory judge guard it.
- **Fix (researched):** a deterministic AST gate. Playwright matchers form a strength lattice: `toHaveText/toHaveValue/toHaveCount` (exact) > `toContainText` (partial) > `toBeVisible/toBeAttached` (presence) > removed. Snapshot the in-scope files' assertion AST BEFORE each repair; after the edit reject on: count drop, tier downgrade, negation flip, or argument-specificity loss. Extend `assertion-coverage.ts` (today token-overlap, blind to a downgrade that keeps the literal anchor) with source→migrated tier comparison. Keep `judge.ts` advisory; mutation testing offline only to validate the lattice.
- **Where:** new `scripts/lib/assertion-ast.ts` (`extractPwAssertions`, `MATCHER_TIER`, `compareStrength`) + hook into `repair-loop.ts` before accepting an edit.
- **Sources:** test-oracle subsumption (arXiv 2103.02901), AIMS mutation (2301.12284), Playwright assertions doc, 11joselu/cypress-to-playwright (AST assertion mapping).

### B2 — Framework-semantic failure-class detectors → repair hints (HIGH) — the classes the locator-only loop can't self-heal
Research confirmed `cy2pw`/`11joselu` handle NONE of these (they emit `FIXME_*` / "❌ Not Supported"). Each gets a detector (source-token and/or snapshot signal) feeding a targeted repair hint — the academically-supported pattern (classified hint > raw error: PyTy 2x, Olausson 1.58x; caveat: the detector must be accurate).
- **Dialogs** — source tokens `window:(confirm|alert|before:unload)`, `cy.stub(win,'…')`, `switchTo().alert`. Run-error is unreliable (Playwright auto-dismisses → silent downstream timeout). **Deterministic codemod BEFORE the LLM**: insert `page.on('dialog', d => d.accept()/dismiss())` before the triggering action.
- **Iframes** — source `switchTo().frame`/`cy.iframe`/`.its('0.contentDocument')`; OR snapshot signal "target present only under an `- iframe:` node". Fix `frameLocator()`/`contentFrame()`; pre-LLM codemod when a frame token exists + repair-hint for the implicit case.
- **Popups/tabs** — source `removeAttr('target')`, `cy.stub(win,'open')`, `getWindowHandles()`, `switchTo().window`. Detector-hint (not blind codemod): `const [popup]=await Promise.all([page.waitForEvent('popup'), <click>]); await popup.waitForLoadState();`.
- **Network interception** — `cy.intercept(...).as()`+`cy.wait('@x')` is silently DROPPED (cy2pw maps to a passive `waitForResponse`, discards the body via `args.slice(1)` → false green against the real backend). **SOURCE-vs-OUTPUT completeness validator** (hard gate): for each source intercept URL, require a `page.route(... route.fulfill(body))` and, where the source asserted on the interception, `waitForResponse`+`expect(response.status()/json())`.
- **Sources:** playwright.dev/docs/{dialogs,pages,mock,network,api/class-framelocator}; cy2pw `mapCy.ts`; FeedbackEval 2504.06939; InferFix 2303.07263; FlakyFix 2307.00012.

### B3 — Batch-mode isolation (MEDIUM) — the proper fix for DEF2's overwrite case
`--inputs` runs N migrations sharing `outputs/helper` without isolation. The right fix is snapshot-and-restore around each `runOne` (not wipe-forward, which only keeps the last) so each input's POMs are authored by exactly one migration; the human reviews one at a time. Document `--isolate` in the batch help.

### B4 — Smaller validator gaps (MEDIUM/LOW, deterministic, quick)
- `plan-envelope-validate.ts`: scenario-coverage falls back to all code files on no basename-match (false pass); subtractive-imports check is skipped when `--code` omitted.
- `validate-report-metrics.ts`: LOC-delta consistency tolerance mismatched with the individual LOC checks.
- `migrate-local.ts`: DOM-probe (which lifts the 0.69 confidence cap) only runs when `MIGRATION_TARGET_URL` is set — offline migrations are permanently capped; surface that explicitly.
- `dom-snapshot.ts`: lazy/late content + hidden/offscreen elements absent from the snapshot (grounding can't confirm a locator that renders after capture) — already partly handled by IMP1 `--flow`; consider a post-load settle.

## Architecture decisions validated by research
- **Deterministic-head / LLM-tail** (codemod the mechanical, LLM the ambiguous): strongly supported — OpenRewrite "do no harm", Google LSC ("computers, not humans"), Meta "Code the Transforms" (arXiv 2410.08806), Amazon's 80/20. Validates IMP4 (codemod pre-pass) + the B2 dialog/iframe codemods.
- **Classified failure-class hint > raw error feedback**: supported with hard numbers (PyTy ~2x, RAP-Gen +478 bugs, Olausson 1.58x), with the caveat that the win comes from the hint being ACCURATE/targeted, not from structure per se (FeedbackEval). Validates the B2 detector-hint design + the existing `isAuthBootstrapFailure` pattern.

## Not pursued (deliberately)
- Mutation-kill as a per-repair gate (too slow/flaky against a live SUT — offline lattice-validation only).
- The judge as a hard gate (gameable by the same loop it gates — keep advisory).
- A provenance "orphan" gate (false-positives on legitimate reuse — see DEF2).
