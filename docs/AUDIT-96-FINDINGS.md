# 96%-readiness audit — findings & roadmap

> Multi-agent audit (2026-06-22). 10 discovery dimensions → triage → adversarial verify → solution research.
> Synthesis hand-finished from harvested agent output (the synthesis agent was cut for budget). Every claim
> below carries file:line evidence in the source transcripts; anchors are quoted inline.

## Executive summary — the honest state is worse than the prior "honest baseline" said

The prior session's ~0.69-confidence / 60%-auto-ship / 33%-acceptable numbers are themselves **not trustworthy**,
and the DOM-grounding work landed today (#232–#234) is **structurally inert on real pwm-blueprint output**. The audit
found that on the measured pipeline you currently **cannot trust any quality number it prints**:

- **CI scores the WRONG spec.** `find outputs/tests … | head -1` always returns `force-clicks.spec.ts`, so every
  migration's confidence + verify-trigger is computed against a *different, fixed* file. Report headers are
  independently mis-wired (`silent-conditionals.md` → "Output: nth-selectors").
- **DOM grounding can never engage.** The probe is fed only the spec, but pwm-blueprint specs contain **zero**
  locators (all live in POMs) → `domGrounded` is permanently false → the 0.69 unverified-cap is a permanent
  floor. Stage 1 never captures a snapshot; no plan carries a `// dom-snapshot:` annotation. **The grounding
  half of the investment protects nothing at the point the locator is written.**
- **The scorer rewards hallucinations.** `selectorQualityScore` is a surface string-count: an invented
  `getByTestId('cart-count')` scores identical to a verified one, and returns 1.0 when a file has 0 locators
  (so every spec banks a free 1.00 on 25% of the weight). The heaviest input — plan confidence, 40% — is a
  prose keyword scan (`/\bhigh\b/` anywhere in a line).
- **The headline 33% number is LLM-generated**, has no rubric, n=5, is unreproducible, and the `verifications`
  DB table is empty. At n=5 the 95% interval is ~23–88% — it cannot distinguish 33% from 96%.

So the dominant blocker is **trustworthy-measured-quality**: until the tool measures honestly, "96% ready" is
unmeasurable, not just unmet.

## Per-indicator honest score + gap to 96%

| Indicator | Now (est.) | What blocks it | Closing problems |
|---|---|---|---|
| trustworthy-measured-quality | **~30%** | wrong-spec scoring, inert grounding, gameable scorer, unauditable label | ci-scores-wrong-spec, grounding-cap-permanently-unreachable, hallucinated-locators-ship-green, plan-confidence-keyword-scan, human-acceptable-label-unauditable, scorer-scores-whole-shared-pom |
| pipeline-engineering | **~55%** | no source-equivalence gate, warn-checks never gate, whole-tree validation is run-order dependent | no-source-equivalence-gate, warn-checks-never-gate, validator-runs-over-whole-tree, scorer-scores-whole-shared-pom |
| multi-framework | **~25%** | Cypress/Selenium never reach Stage-2 output; 70% gate has zero datapoints; offline gate blind on native syntax | cypress-selenium-never-reach-output, offline-gate-blind-on-cypress-selenium-and-noop-on-pw |
| adoptability | **~40%** | CI bot-PRs don't trigger gates; no local plan command; README oversells | ci-adoption-path-broken-out-of-box, no-local-stage1-for-own-test, readme-oversells-vs-honest-baseline |
| rag | **~30%** | off by default, never A/B-measured, MAP@3 inflated by framework-token self-match | rag-decorative-unmeasured |

## The 15 problems (severity-ranked) with researched fixes

### S5 — severity 5 (block 96% on their own)

1. **grounding-cap-permanently-unreachable** [trustworthy] · eff L — Probe is fed only the spec; pwm-blueprint specs
   have 0 locators → `domGrounded` permanently false → 0.69 cap is a floor; Stage 1 never captures a snapshot.
   **FIX:** make `dom-ground.ts extractLocators` accept a SET of files and feed it the same emitted tree the
   scorer credits (follow fixtures into POMs); add `--probe-extra`; wire a real Stage-1 snapshot capture so a
   `// dom-snapshot:` annotation can exist. *Evidence: evaluate.ts:444/460/685-694, migrate.yml:1162.*

2. **ci-scores-wrong-spec** [trustworthy] · eff M — `find … | head -1` evaluates the lexically-first prior
   migration; AST-diff gate has the same defect; report Source→Output headers mis-wired.
   **FIX:** extract local `findGeneratedSpec` (basename-scoping) into a shared CLI helper, call it from both CI
   gates, re-validate report headers. *Evidence: migrate.yml:1220-1231, migrate-local.ts:573-579.*

3. **hallucinated-locators-ship-green** [trustworthy] · eff M — All 5 POMs invent `getByTestId`/`getByRole`
   absent from source (CSS/index-only); scorer counts them as canonical; reports print "100% canonical".
   **FIX:** graded provenance-aware SelectorMix {canonicalVerified, canonicalUnverified, fragile}; parse the
   plan's own "Qn unresolved / not confirmed" markers; add a validator for false "fallback kept" comments.
   *Evidence: product-listing/cart/search-filters.page.ts, evaluate.ts:224-228, generate.md:202/234.*

4. **no-source-equivalence-gate** [pipeline] · eff L — Nothing checks the migration asserts the SAME behavior as
   source; `ASSERTION_FLOOR=1`; envelope `expectedAssertions` is declared but **never read**.
   **FIX:** new `scripts/assertion-coverage.ts` turning `envelope.scenarios[].expectedAssertions` into a hard
   gate + confidence input (ts-morph intent map source→output); calibration fixtures. *Evidence: evaluate.ts:304/324/446-462, plan-code-coverage.ts:58.*

5. **human-acceptable-label-unauditable** [trustworthy] · eff L — The 33% number is LLM-judged, no rubric, the
   `verifications` table is empty, n=5 (DISTINCT=5 but COUNT=14 re-scores → metrics over-report ~3×), no CIs.
   **FIX:** `docs/acceptance-rubric.md` (binary verdict) + `labels/acceptance.jsonl` + `scripts/lib/binom.ts`
   (Wilson) + `acceptance-calibrate.ts` joining labels↔confidence to fit the real gate. *Evidence: baseline.md:56-73, verifications COUNT=0.*

6. **cypress-selenium-never-reach-output** [multi-framework] · eff L — No Stage-2 output or measured quality for
   3 of 4 frameworks; conformance fixtures are hand-authored (never call Claude); selenium-java baseline always
   exits 0 against a golden that itself violates pwm-blueprint rules.
   **FIX:** `scripts/measure-framework.ts` mirroring the bad-PW path; run real Cypress + Selenium corpora;
   gate promotion on recorded numbers (add `framework` column). *Evidence: outputs/tests = bad-PW only, baseline.md:24.*

7. **rag-decorative-unmeasured** [rag] · eff L — `STAGE1_RAG` defaults off; zero shadow/on runs; MAP@3=0.868
   inflated (82.8% of relevance is framework-match; query seeds the framework token; MAP computed over 16
   goldens not the 31-doc index).
   **FIX:** offline `scripts/rag-ablation.ts` (plan quality with vs without retrieval); fix `isRelevant` to not
   self-match framework; correct the doc's MAP claim. *Evidence: plan.yml:556, rag-map3-evaluator.ts:204-212/274.*

8. **ci-adoption-path-broken-out-of-box** [adoptability] · eff M — Bot PRs use default `GITHUB_TOKEN` → GitHub
   won't trigger `danger.yml`/`lint-output.yml` → code PR sits UNSTABLE; pilot-kit omits the required GitHub App.
   **FIX:** add `actions/create-github-app-token` to plan.yml + migrate.yml (fallback to `github.token`);
   document `PWM_APP_ID`/`PWM_APP_PRIVATE_KEY` in pilot-kit + a doctor check. *Evidence: migrate.yml:1271, troubleshooting.md:211-227, pilot-kit.md:56-57.*

### S4 — severity 4

9. **no-local-stage1-for-own-test** [adoptability] · eff M — `npm run migrate` dead-ends on "no approved plan";
   `try-it` is hard-wired to the demo. **FIX:** add `npm run plan -- --input <path>` (local Stage-1 porting
   plan.yml's call + gates + envelope). *Evidence: migrate-local.ts:605, try-it.ts.*

10. **plan-confidence-keyword-scan** [trustworthy] · eff M — 40%-weight input is `/\bhigh\b/` first-match prose
    scan; gameable, mis-reads non-high/med/low vocabularies as no-data. **FIX:** read the envelope's validated
    `locatorTable[].confidence` enum; column-aware fallback only. *Evidence: evaluate.ts:335-356/454.*

11. **scorer-scores-whole-shared-pom** [pipeline] · eff L — Scorer unions WHOLE shared POM files (dead/inherited
    methods) → confidence drifts to 1.0 + history-coupled non-determinism (tree never reset between migrations).
    **FIX:** method-reachability slice (`sliceReachablePom`); reset shared helper between legs. *Evidence: evaluate.ts:633-679, migrate-local.ts:645-656.*

12. **warn-checks-never-gate** [pipeline] · eff M — 17 conformance checks are warn-only and the pipeline runs
    without `--strict`, so W1/W2/W5/W15 (the exact defect classes behind 33%) never block. **FIX:** new "defect"
    severity tier that gates these four + inline-suppression escape. *Evidence: validate-pwm-blueprint-conformance.ts:1267-1268, migrate-local.ts:383.*

13. **offline-gate-blind-on-cypress-selenium-and-noop-on-pw** [multi-framework] · eff M — Offline abstention gate
    (today's default grounding) drops pins on native `cy.get`/`driver.find_element`, skips low/med rows, and on
    bad-PW HIGH rows the name is trivially derivable (proves the LLM copied it). **FIX:** header-aware column
    parsing; corpus from real Original literals; cross-language basename fix. *Evidence: validate-plan-dom-grounding.ts:276-297/342-347/448-463.*

14. **readme-oversells-vs-honest-baseline** [adoptability] · eff S — README leads "PROVEN/6-6/5-5/GREEN", buries
    the 33%/anti-correlated finding (grep = 0 hits); CLAUDE.md's prompt-tune ban cites a non-existent ROADMAP
    section. **FIX:** lead with the honest number; remove/retract the unfounded prompt-tune ban; run the A/B.
    *Evidence: README.md:84-94, CLAUDE.md:94 ('NOT to do' = 0 matches).*

### S3 — severity 3

15. **validator-runs-over-whole-tree** [pipeline] · eff M — tsc/eslint/`pw --list`/envelope run over the entire
    accumulated tree → a sibling's broken state non-deterministically passes/fails THIS leg + burns tokens on
    START-OVER. **FIX:** scope eslint/`--list` to this leg's files; keep project-wide tsc only. *Evidence: migrate.yml:759/770/782-792.*

## Sequencing (ROI order, dependency-aware)

**Wave 1 — make any number trustworthy (do first; everything depends on it):**
`ci-scores-wrong-spec` → `grounding-cap-permanently-unreachable` → `hallucinated-locators-ship-green` →
`plan-confidence-keyword-scan`. These four fix the scorer so confidence means something.

**Wave 2 — measure honestly:** `human-acceptable-label-unauditable` (rubric + Wilson + label corpus). Now you
can *report* a defensible %.

**Wave 3 — raise the number:** `no-source-equivalence-gate` + `warn-checks-never-gate` + `scorer-scores-whole-shared-pom`
(stop clean-but-wrong + brittle-fallback + contamination from auto-shipping).

**Wave 4 — breadth + adoption (parallelizable):** `cypress-selenium-never-reach-output` +
`offline-gate-blind-…` (multi-framework); `ci-adoption-path-broken` + `no-local-stage1` + `readme-oversells`
(adoptability); `rag-decorative-unmeasured` (rag); `validator-runs-over-whole-tree` (determinism).

**Biggest single blocker:** the **scorer trust cluster** (Wave 1). The tool's entire value proposition is
"trust the output"; today the number it prints describes the wrong file, can't see grounding, and rewards
hallucinations. Fix that first or 96% is meaningless.
