# Validator calibration ritual

> "An uncalibrated validator is WORSE than no validator — it produces false
> confidence." — Sakasegawa 2026, on the cost of premature CI gating.

Every validator that can fail a PR MUST be proven, before promotion from
`mode: warn` to `mode: block` in any workflow, to:

1. accept at least three known-good fixtures (real plans / envelopes / diffs
   that should pass), and
2. reject at least three known-bad fixtures (specific failure modes the
   validator claims to catch), each with a recognisable error message.

If either side breaks, the validator is silently lying about its judgement.

## Run

```bash
npm run calibrate                      # all validators
npx tsx tools/calibrate-pipeline/run-calibration.ts --validator kb-validate
```

Exit 0 iff every fixture's actual exit code AND golden substrings match.

## Calibration state

All 15 wired validators are green (`npm run calibrate` → 100 fixtures, exit 0).
Counts are good/bad fixtures actually on disk; Gate is where the validator runs.

| Validator                     | good/bad | State      | Gate (where it runs)                          |
| ----------------------------- | -------- | ---------- | --------------------------------------------- |
| `kb-validate`                 | 3 / 3    | CALIBRATED | regression-test.yml (CI block)                |
| `plan-envelope-validate`      | 3 / 3    | CALIBRATED | migrate.yml (Stage 2 block)                   |
| `ast-diff-trivial-check`      | 6 / 5    | CALIBRATED | migrate.yml (Stage 2 block)                   |
| `validate-examples`           | 3 / 3    | CALIBRATED | regression-test.yml (CI block, `--strict`)    |
| `plan-code-coverage`          | 3 / 3    | CALIBRATED | migrate.yml (Stage 2 block)                   |
| `dom-ground`                  | 3 / 4    | CALIBRATED | migrate.yml (block under `DOM_GROUND_STRICT`) |
| `verify-tally`                | 4 / 2    | CALIBRATED | verify.yml (consensus tally) — 2 bad cover both modes (missing SDET, malformed CR) |
| `danger-policy`               | 3 / 3    | CALIBRATED | dangerfile.ts (PR gate; goldenless by design) |
| `cypress-conformance`         | 4 / 4    | CALIBRATED | migrate.yml (qa-master conformance block)     |
| `selenium-python-conformance` | 3 / 3    | CALIBRATED | migrate.yml (qa-master conformance block)     |
| `selenium-java-conformance`   | 3 / 3    | CALIBRATED | migrate.yml (qa-master conformance block)     |
| `rag-bm25`                    | 5 / 3    | CALIBRATED | Phase-1 RAG retrieval (shadow/optional)       |
| `helper-usage`                | 3 / 3    | CALIBRATED | migrate.yml (warn-only)                       |
| `validate-todo-discipline`    | 3 / 3    | CALIBRATED | migrate.yml (Stage 2 block)                   |
| `validate-report-metrics`     | 3 / 3    | CALIBRATED | migrate.yml (Stage 2 block)                   |

Promote a validator from `UNCALIBRATED` to `CALIBRATED` only after
`npm run calibrate -- --validator <name>` is green AND its row in the
table above is updated in the same PR. The runner emits a non-failing
`[WARN under-calibrated]` line for any validator with zero good OR zero bad
fixtures (hollow green — proves only one side); danger-policy is exempt.

## CI integration

Wired. `npm run calibrate` runs as a block-gating matrix check in
`.github/workflows/regression-test.yml` (`- check: calibrate`), so a fixture
regression fails CI. Several of these validators ALSO block-gate the live
pipeline directly in `migrate.yml` (plan-envelope-validate, ast-diff-trivial-check,
plan-code-coverage, the qa-master conformance check, validate-todo-discipline,
validate-report-metrics — no `|| true`); helper-usage runs warn-only.

## Adding a fixture

1. `fixtures/<validator>/{good,bad}-NN-<slug>.{md,json,ts dir}`
2. `golden-outputs/<validator>/<same-stem>.expected.txt` — one substring
   per non-comment line; lines starting `#` are comments.
3. `npm run calibrate -- --validator <name>` must stay green.

Author each bad fixture so it triggers exactly ONE failure mode the
validator claims to catch — a fixture firing two violations leaves
calibration ambiguous when the validator regresses on one of them.
