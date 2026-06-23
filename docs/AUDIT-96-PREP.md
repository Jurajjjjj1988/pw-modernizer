# 96%-readiness audit — warm-start hypotheses

> Prep note (2026-06-22, 17:26 CEST). Feeds the scheduled audit workflow at 19:31.
> These are the BIGGEST suspected quality-lowering problems, pre-identified from the
> measured baseline + today's grounding PRs. The workflow should VERIFY/REFINE these
> (adversarially) and research fixes — not rediscover cold. Each maps to one of the 5
> readiness indicators: pipeline-engineering, trustworthy-measured-quality, multi-framework,
> adoptability, rag.

## Already landed today (do not re-propose)
- #232 W15 — POM-contamination detection (shared page load-gate must not gate on scenario content).
- #233 — offline abstention gate (no SUT → high-confidence pin whose name isn't derivable from source = fail).
- #234 — grounding-default in CI (pre-generate snapshot capture + closed-vocabulary injection; offline gate in plan.yml/migrate.yml).

## Ranked hypotheses (H1 = biggest blocker)

### H1 — The scorer does NOT predict human-acceptable [trustworthy-measured-quality] — THE blocker
Even after #218/#219/#228, mean confidence ~0.69 / 60% auto-ship, yet real n=6 batch was only **~33% human-acceptable**.
A 0.7-confidence gate that ships ~33%-good output is not trustworthy. **You cannot claim 96% without a scorer
that correlates with human judgement.** FIX DIRECTION: build a labeled corpus, fit/validate the confidence→acceptance
calibration curve, recalibrate the 0.7 gate to the point that actually predicts acceptable. Evidence: scripts/evaluate.ts,
docs/measured-quality-baseline.md.

### H2 — Sample size too small to claim any % [trustworthy-measured-quality / measurement-rigor]
n=5 and n=6. No confidence intervals. "human-acceptable" labeling rubric is undefined. 96% on n=6 is noise.
FIX: define an acceptance rubric (binary + reason codes), label ≥30–50 real migrations, report with CIs and drift-over-time.

### H3 — DOM grounding engages only when a SUT exists [pipeline-engineering / quality]
Grounding is now wired but fires only with MIGRATION_TARGET_URL. Most migrations have no live SUT → offline gate only
(forces honesty, does NOT ground). Open question: does Stage 1 actually PRODUCE the `// dom-snapshot:role=..|name=..`
annotations the validator expects? FIX: measure annotation production rate; expand public-SUT coverage
(docs/dom-ground-public-suts.md); report the % of migrations where grounding actually engages.

### H4 — Semantic equivalence to the source is never verified [pipeline-engineering]
Validators check structure/style/locators, but nothing checks the migrated test asserts the SAME behavior as the source.
A clean-but-wrong migration passes every gate. FIX: a semantic-diff/equivalence check (assertion-intent mapping
source→output). Evidence: scripts/semantic-regression-check.* (does it cover this?), validator wall in migrate-local.ts.

### H5 — Cypress/Selenium unmeasured at scale [multi-framework]
Only bad-PW is the 70% bar; Cypress/Selenium are example-status. Real corpora not run/measured.
FIX: run real Cypress + Selenium inputs end-to-end, measure honest acceptance, then promote. Evidence: inputs/*, examples/*.

### H6 — RAG may be decorative, not load-bearing [rag]
MAP@3 0.868, but does a retrieved neighbor actually change/improve the emitted plan? Corpus may be too small to matter.
FIX: ablation study — plan quality with vs without retrieval on the same inputs. Evidence: scripts/rag-*, docs/rag-phase1.md.

### H7 — Validator false negatives [pipeline-engineering]
Defect classes likely slipping through: assertion roulette, brittle CSS surviving as "fallback", try/catch in page methods,
ad-hoc `.first()` lookups. Calibration fixtures may be hand-written toys vs real-world. FIX: enumerate uncaught classes,
add fixtures from REAL failures, add the missing checks.

### H8 — Generation-prompt quality left on the table [pipeline-engineering]
The "never prompt-tune (negative ROI)" stance may be wrong if Stage-2 output is only ~33% acceptable. Worth an
evidence-based revisit (controlled A/B on the generate prompt against the labeled corpus from H2).

### H9 — Adoptability friction [adoptability]
Node-22 requirement, auth setup, the "approved plan must exist first" prerequisite, error-message clarity.
A new user's first run likely fails on one of these. FIX: smooth the --check doctor + first-run path. Evidence:
scripts/migrate-local.ts (--check), docs/quickstart.md, docs/pilot-kit.md.

## Synthesis prior
Single biggest blocker = **H1 (untrustworthy scorer)**: without a scorer that predicts human-acceptable, 96% is
unmeasurable. H2 (sample size) is its twin. Everything else is downstream of being able to MEASURE quality honestly.
Sequence: H1+H2 first (make quality measurable & trustworthy), then H3/H4/H7 (raise it), then H5/H6/H8/H9.
