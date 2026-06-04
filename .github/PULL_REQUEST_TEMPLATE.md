## Summary

<!-- 1-3 sentences. What changes, why. -->

## Verification

- [ ] `npm run smoke` passes locally
- [ ] If this changes prompts or fragments: re-ran `npm run assemble-prompts` and committed `prompts/_assembled/`
- [ ] If this adds a validator: added 3+3 calibration fixtures under `tools/calibrate-pipeline/fixtures/<validator>/`
- [ ] If this changes the confidence formula: documented the rationale + cited the source (research paper or production system)

## Test plan

<!-- How would a reviewer verify the change works? -->

## Research backing (if applicable)

<!-- Cite the arXiv ID, paper title, library, or production-system pattern this change adopts. -->

## Pipeline impact

- [ ] Affects Stage 1 (analyze.md, plan.yml, plan output, envelope sidecar)
- [ ] Affects Stage 2 (generate.md, migrate.yml, code output, evaluate.ts, plan-code-coverage)
- [ ] Affects verify CANDOR (verify-sdet.md, verify-code-review.md, verify.yml tally job)
- [ ] Affects DOM grounding (dom-ground.ts, migrate.yml dom-ground step, DOM_GROUND_STRICT)
- [ ] Affects validators (kb-validate, validate-examples, plan-envelope-validate, ast-diff-trivial-check, plan-code-coverage, dom-ground, assemble-prompts)
- [ ] Affects regression-test gates (CI matrix) or regression-semantic (pre-release sweep)
- [ ] Affects metrics (metrics-report, metrics-export, dashboard, SQLite schema)
- [ ] Documentation only

## Breaking changes

<!-- Anything that would invalidate existing plans / examples / fixtures? -->
