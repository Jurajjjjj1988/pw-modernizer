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

| Validator                  | State       | Notes                                                                 |
| -------------------------- | ----------- | --------------------------------------------------------------------- |
| `kb-validate`              | CALIBRATED  | 3 good + 3 bad (dangling ref, malformed kebab, duplicate definition). |
| `plan-envelope-validate`   | CALIBRATED  | 3 good + 3 bad (subtractive conflict, missing id, foreign import).    |
| `ast-diff-trivial-check`   | CALIBRATED  | 3 good + 3 bad (rename-only, comment-only, whitespace-only).          |
| `validate-examples`        | CALIBRATED  | 3 good + 3 bad (phantom KB, orphan Q-slug, mixed failures).           |

Promote a validator from `UNCALIBRATED` to `CALIBRATED` only after
`npm run calibrate -- --validator <name>` is green AND its row in the
table above is updated in the same PR.

## CI integration

Out of scope for this directory. `npm run calibrate` is a manual ritual
today; wiring it into `.github/workflows/regression-test.yml` is a
follow-up PR that gates promotion of any validator's `mode: warn` ->
`mode: block`.

## Adding a fixture

1. `fixtures/<validator>/{good,bad}-NN-<slug>.{md,json,ts dir}`
2. `golden-outputs/<validator>/<same-stem>.expected.txt` — one substring
   per non-comment line; lines starting `#` are comments.
3. `npm run calibrate -- --validator <name>` must stay green.

Author each bad fixture so it triggers exactly ONE failure mode the
validator claims to catch — a fixture firing two violations leaves
calibration ambiguous when the validator regresses on one of them.
