# Pilot kit — running PWmodernizer against a real codebase

This is the operator-facing checklist for taking PWmodernizer from "I ran
`npm run try-it` and saw a plan" to "my team's legacy suite is migrating
through CI". It assumes the demo + quickstart already work for you.

A "pilot" here means: 5-15 real legacy tests from one project, taken from
hand-write to pwm-blueprint output, with measured cost + verdict + reviewer
feedback. Two weeks end-to-end is realistic for a 10-test pilot.

## Phase 0 — Decide if you have a pilotable codebase

You need:

- A repo with **5+ legacy E2E tests** (bad-Playwright, Cypress, Selenium-Java,
  or Selenium-Python) that you want to migrate. The pipeline is calibrated
  on these four sources and nothing else.
- **Single-file inputs** for the first pilot — multi-file tests work but
  introduce extra surface area (see Phase 3). Start single-file.
- Tests that **actually run today** on some SUT. Failed-on-prod tests will
  produce noise plans that are hard to evaluate.
- A **reviewer** with QA authority. The pipeline outputs a plan PR and a
  code PR; a human still has to land them. Without a named reviewer the
  pilot stalls at the first verdict.

If you have those four, continue. If not, fix the missing piece first.

## Phase 1 — Pre-flight (1 day)

Fork or clone PWmodernizer into your own GitHub org. The repo runs entirely
on GitHub Actions — your migrations stay on your infra.

```bash
gh repo fork Jurajjjjj1988/PWmodernizer --org your-org --clone
cd PWmodernizer
npm install
npm run try-it
```

The try-it run produces a `outputs/plans/bad-test.spec.ts.md` against the
sample demo. Read it. If the plan structure looks sensible, the pipeline
is alive on your machine.

Set repository variables in your fork:

| Var | Purpose | Default |
| --- | --- | --- |
| `DOM_GROUND_STRICT` | Hard-fail on unresolved locators | `false` until SUT calibration |
| `USE_CACHED_SDK` | Route verify through SDK + prompt caching | `0` (opt-in) |
| `PWM_HUMAN_HOUR_COST_USD` | ROI calculator hourly rate | `80` |

Set repository secrets:

| Secret | Notes |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token from `claude setup-token` |
| `ANTHROPIC_API_KEY` | Required if you also want `USE_CACHED_SDK=1` |
| `PWM_APP_PRIVATE_KEY` | **Strongly recommended.** GitHub App private key. Without it the bot's plan/code PRs are opened with the default token, and GitHub will NOT run `danger.yml` / `lint-output.yml` on them — the PR sits without its gates (the README's "all gates passed" is a lie for you). See `docs/troubleshooting.md` "PR sits UNSTABLE indefinitely". |

And set repository **variable** `PWM_APP_ID` (the GitHub App's numeric id; it is not a secret). Create a minimal GitHub App (repo scope: contents + pull-requests: write), install it on the fork, and put its id in `PWM_APP_ID` + a generated private key in `PWM_APP_PRIVATE_KEY`. When both are absent the workflows fall back to the default token (PRs open, but downstream gates won't fire).

## Phase 2 — First migration (day 2-3)

Copy ONE single-file legacy test from your project into `inputs/<framework>/`.
Use the framework dir that matches the source:

```bash
cp ~/your-project/tests/legacy-login.cy.js inputs/cypress/
git add inputs/cypress/legacy-login.cy.js
git commit -m "pilot: first legacy input"
git push
```

Stage 1 fires automatically on the push. A `migrator:plan` PR opens within
2-3 minutes. **Don't merge it yet.** Read the plan as a human:

- Are the scenarios the LLM identified actually the scenarios in the test?
- Are the locator pins citing things that exist on your SUT?
- Are the anti-patterns it flagged the ones you'd flag?

If yes: merge the plan PR. Stage 2 fires, a `migrator:code` PR opens.

If no: comment `/regenerate <freeform feedback>` on the plan PR. The
pipeline takes your feedback and tries again. Cap is 3 attempts; after
that you take over manually.

## Phase 3 — Multi-file + harder cases (week 2)

Once 3-5 single-file inputs have closed cleanly, try one of these:

- A multi-file test (POMs + helpers + spec in `inputs/<framework>/<test-dir>/`)
- A test with real network mocks (`cy.intercept`, `WebDriverWait`)
- A test that exercises an auth-gated flow (storage state matters)

Each of these probes a specific failure mode. The Stage 2 validators are
calibrated for them, so a failure here is data, not a bug.

## Phase 4 — Measure (continuous)

After day 5 you have enough data to look at the dashboard meaningfully:

```bash
npm run dashboard -- --port 8765
# open http://localhost:8765
```

Three numbers matter:

1. **Cost per migration** — Panel B. SHIP IT < $1.50 is healthy.
2. **First-attempt SHIP IT rate** — count `migrator:code` PRs that didn't
   need a regen. Target: 60%+ after first 10 migrations.
3. **ROI** — Panel C. With default 4h human-hours-saved per test,
   anything above 5× justifies continuing.

If any of the three is off, the next section.

## Phase 5 — Tuning

Common adjustments by symptom:

| Symptom | Likely cause | First lever |
| --- | --- | --- |
| Sonnet hallucinates locators | DOM grounding not configured | Set up `MIGRATION_TARGET_URL`, run `npm run check:dom-ground:live` |
| Plans miss your team's conventions | KB doesn't know them | Add your conventions to `config/knowledge-base.md` |
| Verdicts cluster on START OVER | Calibration corpus too small | Add 3-5 conformance fixtures per anti-pattern you care about |
| Cost above $2 per migration | Prompt size dominates | Turn on `USE_CACHED_SDK=1` and `vars.PWM_PROMPT_CACHE_DEFAULT=on` once it lands |

The ADR at `docs/adr/0001-self-improvement-rag.md` describes the Phase 1
RAG implementation that lowers variability further when the corpus is big
enough.

## Phase 6 — Decide

After 10-15 migrations you have enough data to answer:

- Is this saving the team time? (compare reviewer hours vs. cost)
- Is the code we're getting maintainable by us, or LLM-shaped?
- Are the failure modes ones we can teach the pipeline, or are they
  inherent to the framework migration we want?

If yes to all three: roll out wider. If no on any: drop a postmortem in
`docs/pilots/<your-pilot>.md` explaining which assumption broke, and
either tune (Phase 5) or stop.

## Pilot checklist (copy this into your tracker)

- [ ] Phase 0: 5+ legacy tests, single-file first input picked, reviewer named
- [ ] Phase 1: repo forked, `npm run try-it` green, vars + secrets set
- [ ] Phase 2: first plan PR opened, reviewed by named reviewer, merged or regen'd
- [ ] Phase 2: first code PR opened, validators green, verdict noted
- [ ] Phase 3: one multi-file or harder case attempted
- [ ] Phase 4: dashboard inspected, three numbers recorded
- [ ] Phase 5: at least one tuning lever pulled
- [ ] Phase 6: pilot postmortem written, roll-out / stop decided
