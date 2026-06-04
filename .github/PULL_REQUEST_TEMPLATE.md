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

- [ ] Affects Stage 1 (analyze.md, plan.yml, plan output)
- [ ] Affects Stage 2 (generate.md, migrate.yml, code output, evaluate.ts)
- [ ] Affects verify (verify.md, verify.yml, verdict ladder)
- [ ] Affects validators (kb-validate, validate-examples, plan-envelope-validate, ast-diff-trivial-check, assemble-prompts)
- [ ] Affects regression-test gates
- [ ] Documentation only

## Breaking changes

<!-- Anything that would invalidate existing plans / examples / fixtures? -->
