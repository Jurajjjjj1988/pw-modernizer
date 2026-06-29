# 96%-readiness — next steps (handoff)

> Resume point for the quality-audit remediation. Full evidence + fixes live in
> [AUDIT-96-FINDINGS.md](./AUDIT-96-FINDINGS.md); warm-start hypotheses in
> [AUDIT-96-PREP.md](./AUDIT-96-PREP.md). Work the waves in order. Each fix:
> own branch → smoke green → backdated commit (email juraj.kapusansky@gmail.com,
> NO Claude attribution) → PR → CI green → squash-merge → back to main.

## STATUS: all four waves merged (2026-06-25)

Every code-side item below is **DONE**. What remains is **human/Claude-gated DATA**, not code:
1. **Label the acceptance corpus** — fill verdicts in `labels/acceptance.jsonl` per `docs/acceptance-rubric.md`, then `npm run calibrate:acceptance` (gives the real %+CI and the calibrated gate). ≥30 labels for a defensible headline.
2. **Run the Cypress/Selenium corpora** through Stage 1→2 (`npm run plan` then `npm run migrate`, or CI), then label them → `npm run measure:frameworks` computes each framework's 70%-gate verdict.
3. **RAG on/shadow A/B** on actual plan quality (the offline `npm run rag:ablation` already shows retrieval is load-bearing: +39pts over chance on the 31-plan index).
4. **Optional default-flips after measuring:** `PWM_SCORE_SCOPE=reachable` (scorer), `ASSERTION_COVERAGE_STRICT=true`, `PLAN_ABSTENTION_STRICT` — flip once the label corpus confirms they don't regress acceptance.

### Shipped (PR list)
- Wave 1 (trust): #235 ci-scores-wrong-spec · #236 grounding-cap probe-tree · #237 hallucinated-locator provenance · #238 plan-confidence structured enum.
- Wave 2 (measure): #240 acceptance rubric + Wilson CI + calibration + COUNT(DISTINCT) fix.
- Wave 3 (raise): #241 source-equivalence gate · #242 W1/W2/W5/W15 `--block-defects` · #243 reachable-POM scorer scope.
- Wave 4 (breadth/adoption): #244 GitHub-App bot-PR token · #245 honest README + prompt-tune-ban retracted · #246 offline gate header-aware (Cypress/Selenium) · #247 `npm run plan` local Stage-1 · #248 scoped validator wall · #249 RAG ablation · #250 per-framework promotion gate.
- Earlier groundwork: #232 W15 POM-contamination · #233 offline abstention gate · #234 grounding-default in CI.

## Done so far

**Grounding-default groundwork (earlier):** #232 W15 POM-contamination · #233 offline
abstention gate · #234 grounding-default in CI.

**Wave 1 — make any quality number trustworthy ✅ (all merged):**
- #235 `ci-scores-wrong-spec` — basename-scoped shared resolver (`scripts/output-spec.ts` + `resolve-output-spec.ts`); CI evaluate/ast-diff/report-fix no longer score the lexically-first spec.
- #236 `grounding-cap-permanently-unreachable` — `dom-ground.ts --probe-tree` + `collectEmittedFiles` probe the POMs (proven 0 → 11 locators), so the 0.69 cap can lift with a SUT.
- #237 `hallucinated-locators-ship-green` — provenance-aware SelectorMix (hedged canonical = ½ credit, 0 locators = 0.5 not 1.0).
- #238 `plan-confidence-keyword-scan` — 40%-weight input now reads the schema-validated envelope confidence enum, not `/\bhigh\b/` prose.

## Wave 2 — measure honestly (do next)

**`human-acceptable-label-unauditable`** [trustworthy-measured-quality] · eff L
The headline ~33% number was LLM-generated, no rubric, n=5, the `verifications`
DB table is empty, no CIs. Build the measurement infra (the labels themselves
need a HUMAN — that's a data-entry step, not code):
1. `docs/acceptance-rubric.md` — binary ACCEPTABLE / NOT-ACCEPTABLE verdict, decision boundary, reason codes.
2. `labels/acceptance.jsonl` — one record per migration `{input_basename, framework, verdict, reasons[], rater, date}`.
3. `scripts/lib/binom.ts` — pure `wilsonInterval(k, n, z=1.96) → {lo, hi, point}` (+ unit test).
4. `scripts/acceptance-calibrate.ts` — load labels, JOIN `migrations` on `input_basename`, report acceptance rate with Wilson CI, and fit where the confidence gate actually predicts ACCEPTABLE (recalibrate the hard-coded 0.7 in migrate.yml:~1262).
Also fix `metrics-report.ts:184` `COUNT(*)` → `COUNT(DISTINCT input_basename)` (over-reports migration count ~3×).

## Wave 3 — raise the number

- **`no-source-equivalence-gate`** [pipeline] · eff L — nothing checks the migration asserts the SAME behavior as source; `ASSERTION_FLOOR=1`; envelope `expectedAssertions` declared but never read. New `scripts/assertion-coverage.ts` (ts-morph intent map source→output via `envelope.scenarios[].expectedAssertions`), hard CI gate + confidence input + calibration fixtures.
- **`warn-checks-never-gate`** [pipeline] · eff M — 17 conformance checks are warn-only and the pipeline runs without `--strict`, so W1/W2/W5/W15 (the defect classes behind 33%) never block. Add a "defect" severity tier between warn/block that gates those four; inline-suppression escape; tally `defectCount` in `validate-pwm-blueprint-conformance.ts:~1259-1268`.
- **`scorer-scores-whole-shared-pom`** [pipeline] · eff L — scorer unions WHOLE shared POM files (dead/inherited methods) → confidence drifts to 1.0 + history-coupled non-determinism. Add `sliceReachablePom(pomSrc, calledMethods)` + `extractCalledMethods(specSrc, fixtureName)` in `evaluate.ts:633-679`; reset shared `outputs/helper/` between legs (`migrate-local.ts:645-656`). Gate behind `PWM_SCORE_SCOPE=reachable|whole`.

## Wave 4 — breadth + adoption (parallelizable)

- **`cypress-selenium-never-reach-output`** [multi-framework] · eff L — no Stage-2 output/measured quality for 3 of 4 frameworks. `scripts/measure-framework.ts` mirroring the bad-PW path; run real Cypress + Selenium corpora; add a `framework` metrics column; gate promotion on recorded numbers.
- **`offline-gate-blind-on-cypress-selenium-and-noop-on-pw`** [multi-framework] · eff M — offline abstention gate drops pins on native `cy.get`/`driver.find_element`, skips low/med rows, trivially passes copied bad-PW HIGH names. Header-aware column parse + corpus from real Original literals, in `validate-plan-dom-grounding.ts:276-297/342-347/448-463`.
- **`ci-adoption-path-broken-out-of-box`** [adoptability] · eff M — bot PRs use default `GITHUB_TOKEN` so `danger.yml`/`lint-output.yml` never run. Add `actions/create-github-app-token` to plan.yml + migrate.yml (fallback to `github.token`); document `PWM_APP_ID`/`PWM_APP_PRIVATE_KEY` in pilot-kit + a doctor check.
- **`no-local-stage1-for-own-test`** [adoptability] · eff M — `npm run migrate` dead-ends on "no approved plan"; `try-it` is demo-hardwired. Add `npm run plan -- --input <path>` (local Stage-1: `scripts/plan-local.ts` porting plan.yml's Claude call + gates + envelope).
- **`readme-oversells-vs-honest-baseline`** [adoptability] · eff S — README leads PROVEN/6-6/5-5/GREEN, buries the 33%/anti-correlated finding; CLAUDE.md's prompt-tune ban cites a non-existent ROADMAP section. Lead with the honest number; retract the unfounded prompt-tune ban; run the A/B.
- **`rag-decorative-unmeasured`** [rag] · eff L — `STAGE1_RAG` off by default, zero A/B runs, MAP@3 inflated by framework-token self-match. `scripts/rag-ablation.ts` (plan quality with vs without retrieval); fix `isRelevant` (rag-map3-evaluator.ts:204-212); correct the doc's MAP claim.
- **`validator-runs-over-whole-tree`** [pipeline] · eff M — tsc/eslint/`pw --list`/envelope run over the whole accumulated tree → run-order-dependent pass/fail + wasted START-OVER tokens. Scope eslint/`--list` to this leg's files (migrate.yml:759/770/782-792); keep project-wide tsc only.

## Per-indicator gap (from the audit)
trustworthy-measured-quality ~30% (Wave 1 lifts this most; Wave 2 makes it reportable) · pipeline-engineering ~55% · multi-framework ~25% · adoptability ~40% · rag ~30%. Biggest remaining single blocker after Wave 1: the measurement itself (Wave 2) — you still cannot *report* a defensible % until the label corpus + Wilson CI exist.
