# PWmodernizer

[![Regression contracts](https://github.com/Jurajjjjj1988/PWmodernizer/actions/workflows/regression-test.yml/badge.svg)](https://github.com/Jurajjjjj1988/PWmodernizer/actions/workflows/regression-test.yml)
[![Lint generated tests](https://github.com/Jurajjjjj1988/PWmodernizer/actions/workflows/lint-output.yml/badge.svg)](https://github.com/Jurajjjjj1988/PWmodernizer/actions/workflows/lint-output.yml)
[![Danger PR policy](https://github.com/Jurajjjjj1988/PWmodernizer/actions/workflows/danger.yml/badge.svg)](https://github.com/Jurajjjjj1988/PWmodernizer/actions/workflows/danger.yml)
![Node 22+](https://img.shields.io/badge/node-22%2B-3c873a)
![Playwright](https://img.shields.io/badge/output-Playwright%20TS-2ead33)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

An LLM-driven pipeline that migrates legacy E2E tests — bad Playwright, Cypress, Selenium (Java + Python) — into clean Playwright TypeScript you own, then **runs the migrated test against the live app and repairs it until it actually passes**. Output is standard `.spec.ts` files, not a proprietary DSL.

The point isn't "convert the syntax" — every codemod does that and produces tests that *compile but don't work*. The point is to catch the failures that only appear when the migrated test runs: a hallucinated locator the real DOM doesn't have, auth that was never wired up, a green that was bought by skipping or weakening an assertion. **A migration is accepted only when it runs green against the real app.**

> [!TIP]
> Skip to [What the closed loop catches](#what-the-closed-loop-catches) for the failure modes this exists to stop — that's the substance.

## Quick start

```bash
git clone https://github.com/Jurajjjjj1988/PWmodernizer.git && cd PWmodernizer
npm install
npm run migrate -- --check                 # zero-token preflight: Node 22 / Claude auth / plan setup
npm run try-it                             # ~90s: a real Stage-1 plan on the bundled demo (add -- --mock for no token)
```

Then migrate your own test end-to-end — no fork, no CI secrets:

```bash
npm run plan    -- --input inputs/<framework>/your-test.<ext>           # Stage 1: the auditable plan
MIGRATION_TARGET_URL=https://your.app \
npm run migrate -- --input inputs/<framework>/your-test.<ext> --repair --isolate
```

`--repair` runs the closed loop (generate → run vs the live app → repair on failure → accept only when green). `--isolate` keeps each migration's page objects from colliding with the last. Auth: `claude setup-token` (Claude Pro/Max) **or** `ANTHROPIC_API_KEY`.

## How it works

Three stages, each gated; the last two close a loop against your real app.

```
your legacy test
      │
      ▼
┌─────────────┐   reads knowledge-base + rules + a real production style anchor
│  1 · Plan   │   writes an auditable markdown plan + a machine-validatable JSON envelope
└─────────────┘   ── you review the plan (locator table, confidence per row) and merge
      │
      ▼
┌─────────────┐   grounds on a live aria snapshot of the target page (closed vocabulary)
│  2 · Generate│  emits the qa-master layered tree (spec + page objects + fixtures)
└─────────────┘   ── a static validator wall runs: tsc · eslint-playwright · pw parse ·
      │              plan↔code coverage · qa-master conformance · auth/network/provenance gates
      ▼
┌─────────────┐   RUNS the migrated test against MIGRATION_TARGET_URL
│  3 · Run +  │   green → accept · red → feed the failure + the failure-time page snapshot
│    repair   │   back to the model → fix the locator/target → re-run (bounded)
└─────────────┘   ── accept ONLY when it runs green, on the correct file, weakening nothing
```

Static gates prove a migration *compiles*. Only running it against the real app proves it *works* — and the error from that run is the richest possible repair signal. When no live app is available the loop degrades to the static gates + a confidence score; a low score routes to a second-opinion **verify** pass (two independent reviewer agents, majority verdict).

## What the closed loop catches

Every row is a failure that passes `tsc` and every static gate, yet ships a broken or dishonestly-green test. Each is closed by a deterministic gate or an execution-guided repair — not a prompt nudge.

| Failure mode | How it would ship green | How it's caught |
| --- | --- | --- |
| **Hallucinated locator** — `getByRole('heading', …)` for an element the app renders as a `<span>` | compiles, passes every static gate, times out on the app | DOM grounding (closed-vocabulary aria snapshot) + the **execution gate** — it has to run |
| **Auth not self-contained** — emits `storageState: '…/auth.json'` nothing creates | dies at setup (ENOENT) before a page loads | repair detects the class + rewrites to an inline `beforeEach` login from the source's own steps |
| **False green** — `1 passed, 2 skipped`, an all-skipped run, a flaky pass, or "passed" in a test title | the gate reads the word "passed" and accepts | the verdict parser requires a real tally: `passed ≥ 1 AND failed/skipped/flaky/interrupted = 0` |
| **Wrong-file repair** — the model free-names the spec, the resolver edits an unrelated committed example | a misattributed green on the wrong file | resolve by the plan-provenance header every spec carries; refuse to guess over corrupting |
| **Weakened assertion** — repair turns `toHaveText('3')` into `toBeVisible()` to go green | green, but the test no longer verifies anything | an AST strength gate: count drop, negation drop, or matcher-tier drop is rejected, then re-verified |
| **Framework-semantic gap** — dialogs, iframes, popups/tabs, `cy.intercept` network stubs | locator is right, the *behaviour* is missing | failure-class detectors (source token / run error / snapshot) append a targeted Playwright fix hint |
| **Dropped network stub** — `cy.intercept().as()` + `cy.wait('@x')` silently lost | test passes against the *real* backend, coverage gone | a source-vs-output completeness gate flags the missing `page.route` / `waitForResponse` |
| **Cross-app contamination** — two migrations share-overwrite one page object | both compile; one spec now points at the wrong app's locators | a provenance gate flags a page object authored by more than one migration |
| **Infinite hang** — a stalled model/API call never returns | the whole pipeline hangs forever | every CLI call is bounded by a timeout + retry; a hung step fails cleanly |

Most of these are invisible to syntax-only converters (`cy2pw`, archived 2025, handles none of the framework-semantic cases). They're the difference between "it compiled" and "it runs green on the live app, on the correct file, having corrupted nothing."

## The qa-master output

Stage 2 emits a layered architecture a senior SDET would write — not a single bare `.spec.ts`:

```
outputs/
├── tests/<kebab>.spec.ts               # imports test/expect from @fixtures/base.fixture (never @playwright/test)
└── helper/
    ├── page-object/
    │   ├── basepage.ts / baseblock.ts  # committed scaffolding — wire `page`, no god-class
    │   ├── pages/<name>.page.ts         # PageClass, readonly locator fields with .describe('[LABEL] …')
    │   └── blocks/<name>.block.ts       # reusable sections (≥5 locators / 3 methods)
    ├── fixtures/base.fixture.ts         # the ONLY file allowed to import @playwright/test
    ├── api/ · actions/ · utilities/     # request wrappers · cross-page flows · pure helpers
    └── test-data/ · types/              # constants + labels · data shapes
```

The structure is anchored on a verbatim real-company production tree (`examples/reference/qa-master/`, owner-permitted) and hard-enforced by a conformance validator. Use `--profile lean` for spec + page object only.

## Engineering decisions in 60 seconds

| Decision | Trade-off | Why |
| --- | --- | --- |
| Plan → code in two stages, not one shot | an extra review gate | the plan + JSON envelope are auditable and editable; the code is verified against them line-by-line |
| Accept on **execution**, not on compilation | needs a live SUT to be strongest | "it compiles" is the exact failure class this tool exists to beat |
| Deterministic gate over a prompt nudge | more validators to maintain | a structural gate can't be argued with by a persuasive-but-wrong model |
| Page objects own locators; specs own intent | more files | a locator change ripples through one POM, not every spec; no `BasePage` god-class |
| Repair edits the failing file, grounded on its failure-time snapshot | a re-run per repair | the model sees the exact page the broken locator hit, already authenticated |

## Quality gates

**Stage 0 (pre-flight, no tokens spent):** size + token-budget + UTF-8 encoding + test-marker checks; a secret scan; an adversarial-fixture corpus calibrates the gate.

**Stage 1 (plan):** the JSON envelope validates against a schema; every cited knowledge-base ID must resolve; open-question IDs must bind.

**Stage 2 (generate) — the validator wall, all must pass:** `tsc --noEmit` strict (no `any`) · `eslint-plugin-playwright` (+ research-backed rules, `@playwright/test` blocked outside the fixture) · `playwright test --list` parses · AST-diff-not-trivial (tree-edit distance, real tree-sitter for Java/Python) · plan↔code coverage (every scenario pinned, every required file present) · qa-master conformance · auth-self-contained · network-completeness · POM-provenance · no forbidden patterns (`waitForTimeout`, `force: true`, `.nth()`, `test.only`, `: any`, …).

**Stage 3 (run + repair):** the execution gate against the live app; the assertion-strength gate; the lint gate on the accepted output. A low confidence score (when no live app is set) routes to the two-agent verify pass with a `SHIP IT / FIX FIRST / START OVER` ladder.

Validators are promoted from warn to strict only after fixture-driven calibration; every gate ships with a good/bad fixture corpus so a regression is caught with zero tokens.

## What it does NOT catch

The honest blind spots — name them, don't overclaim:

- **Visual / pixel regressions** — the loop asserts behaviour and DOM state, not screenshots.
- **Apps behind real auth walls** — MFA, CAPTCHA, SSO, or per-user secrets aren't handled; the inline-login path covers demo/test credentials.
- **Non-deterministic backends** — a flaky *app* (not a flaky test) makes the pass/fail signal unreliable; record a baseline first.
- **Long multi-page journeys with deep state** — validated breadth is short-to-medium flows; a 10-step checkout with cross-page state is unproven.
- **Performance budgets, real-email deliverability, concurrent-write races, true cross-browser parity** — out of scope.
- **Mutation-kill effectiveness** — assertion *strength* is gated structurally (AST tiers), but no mutation-testing harness runs per migration.

A migration is **assistive scaffolding under human review**, not a hands-off converter. The accuracy ceiling for LLM-generated Playwright is widely reported around ~85%; plan review capacity accordingly.

## Costs

Anthropic prompt caching keeps the knowledge-base + rules + style anchor (~13k tokens) at 0.1× input price. A typical short migration:

| Stage | Model | Cost |
| --- | --- | --- |
| Plan | Sonnet | ~$0.05 |
| Generate | Sonnet | ~$0.10 |
| Verify (only when confidence is low) | Opus ×2 | ~$0.40 |

Realistic **$0.15–0.55 per migration**. `npm run migrate -- --input … --mock` previews the cost before spending anything.

## Repository structure

```
.github/workflows/   plan · migrate · verify · danger · lint-output · regression · regenerate-dispatch
config/              migration-rules.md (style + structure contract) · knowledge-base.md (anti-patterns + API maps, 4 frameworks)
prompts/             analyze · generate · verify-{sdet,code-review} + _fragments/ (shared) + _assembled/ (CI-consumed)
inputs/              source tests by framework (bad-playwright · cypress · selenium-java · selenium-python · _stress)
outputs/             plans/ · tests/ · helper/ (the qa-master tree) · reports/
examples/            reference/qa-master/ (style anchor) + per-framework golden input/plan/output triples
scripts/             the pipeline — evaluate · dom-ground · repair-loop · the validators + their tests
tools/calibrate-pipeline/   the fixture corpus every validator is calibrated against
docs/                walkthrough · troubleshooting · the closed-loop validation record
```

A fresh session should read `CLAUDE.md` first (a scannable orientation), then `docs/`.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**. The highest-leverage PRs improve `config/migration-rules.md`, `config/knowledge-base.md`, the `prompts/`, or add a validator with its fixture corpus — each raises the floor for every future migration. Run `npm run smoke` before pushing; it mirrors CI (typecheck + the validators + calibration + lint).

## License

MIT. See [`LICENSE`](LICENSE).

## References

- Migrating Code at Scale with LLMs at Google — [arxiv 2504.09691](https://arxiv.org/abs/2504.09691)
- LPW: Planning-Driven Programming (plan-vs-code contract) — [arxiv 2411.14503](https://arxiv.org/abs/2411.14503)
- CANDOR multi-agent consensus verification — [arxiv 2506.02943](https://arxiv.org/abs/2506.02943)
- Test-oracle subsumption / assertion strength — [arxiv 2103.02901](https://arxiv.org/abs/2103.02901)
- Structured feedback beats raw errors in LLM repair — [FeedbackEval, arxiv 2504.06939](https://arxiv.org/abs/2504.06939)
- Test-migration accuracy ceiling (~85%, human review required) — [Microsoft ISE](https://devblogs.microsoft.com/ise/app-modernization-llm-driven-ui-tests-hve/)
- [Playwright](https://playwright.dev) · [eslint-plugin-playwright](https://github.com/playwright-community/eslint-plugin-playwright)
