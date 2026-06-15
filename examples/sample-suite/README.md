# sample-suite — 5-minute first-migration demo

This directory is the demo input for `npm run try-it`. It is intentionally
NOT part of the corpus that `scripts/validate-examples.ts` walks (no
`expected-plan.md`), and not part of `regression-semantic.yml` (no
`input.*` filename). Touching it does not move any calibration metric.

## What's in here

- `bad-test.spec.ts` — ~20 LOC Playwright spec that stacks four common
  anti-patterns (hard waits, `nth(0)` selector roulette, sync probe
  assertion, nested promise chain). Real shape, plausible product (Acme
  Cart). Self-contained — no real SUT, no env config.
- `mock-plan.md` — pre-canned Stage 1 plan returned by
  `npm run try-it --mock`. Lets CI verify the script wiring without
  spending Claude tokens.

## How to use

```bash
npm run try-it           # real Stage 1 call (needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)
npm run try-it -- --mock # pre-canned plan, zero Claude calls, ~1 second
```

The script writes the plan to `outputs/plans/bad-test.spec.ts.md` and
prints the structure narrated for a first-time operator.

## Why this isn't named `input.spec.ts`

`regression-semantic.yml` enumerates every `examples/<dir>/input.*` paired
with an `expected-plan.md` and runs Stage 1 against each on every push.
Naming the demo `bad-test.spec.ts` keeps the regression matrix and the
calibration corpus untouched.
