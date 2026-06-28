# Prior-art research → the path to a reliable migration tool

> Multi-agent web research (2026-06-25, ~15 primary sources fetched). The verdict
> is unanimous and is the answer to "why does the tool feel stuck."

## The one finding that matters

**Every successful system grounds the LLM in a live artifact and validates its
output by EXECUTION; we are the only one doing pure text→text ("generate and
hope").** The fix has the same shape for 3 of our 4 problems:

> **ground → generate → run against the real app → repair on failure → accept only when green.**

Sources that converge on this: Playwright MCP, Stagehand, Skyvern (live a11y-tree
grounding + observe-then-act); Aider, SWE-agent, Devin, Self-Debugging, Reflexion
(execution-guided repair loop); SWE-bench, Amazon Q, Copilot modernization
(acceptance = builds + runs green + no regression); TransCoder, differential
testing, EvoSuite (behavioral equivalence by running both and comparing).

## Why we're stuck: the corpus is synthetic

Our inputs target FAKE apps (`shop.acme.test`, etc.). Live grounding and
execution validation — the #1 lever — are **impossible** on apps that don't
exist, so the tool has only ever been built + measured offline, where locators
can only be guessed and "acceptance" can't be executed. **Breaking the circle
requires real legacy tests against real public apps** (saucedemo, the-internet,
conduit, automationexercise — already catalogued in docs/dom-ground-public-suts.md).

## Per-problem techniques (concrete, adoptable)

### P1 — Locator hallucination
- **a11y-tree snapshot as closed vocabulary** (Playwright MCP / in-process `locator.ariaSnapshot()`): the LLM may only emit a role+name that EXISTS in the snapshot. We capture this (`dom-snapshot.ts`) + inject it (`$DOM_GROUNDING_BLOCK`) — but only when `MIGRATION_TARGET_URL` is set.
- **observe-then-act** (Stagehand): a live resolver returns the selector; the LLM expresses intent, the page produces the locator. `dom-ground.ts` already probes locators against a live URL.
- **multi-candidate + self-heal** (Healenium LCS, score-cap 0.5): emit N ranked candidate locators; keep the first that resolves UNIQUELY against the live page; 0 or >1 = reject.
- **priority order** role→text→label→testid, never CSS-class (Playwright codegen).

### P2 — Measuring acceptance without a human
- **Execution acceptance** (SWE-bench FAIL_TO_PASS / PASS_TO_PASS; Aider): a migrated test is good iff it PASSES against the healthy app AND the suite is unaffected. This is the gate we lack.
- **Mutation-kill parity** (Meta ACH, StrykerJS, EvoSuite): the migrated test must kill ≥ the mutants the source test killed — proves the assertions are load-bearing, not just green. `score = detected/valid`.
- **Calibrated LLM-judge** (MT-Bench/G-Eval) ONLY for non-executable axes (readability, idiom): reference-guided (source test = reference), position-swap-and-average, N-of-M ensemble, calibrate vs a human gold set with Cohen's κ ≥ 0.6.

### P3 — Multi-framework
- **Codemod the deterministic ~80%** (OpenRewrite lesson; cy2pw is pure Babel-AST): API renames, `await` insertion, imports, `test()` wrapping → ts-morph codemods (idempotent, fixture-tested). **LLM only for the ~20% semantic judgment** (selector translation, wait→assertion intent).
- **Official mapping tables** as KB (WebDriverWait→auto-wait, `fill()`, lazy Locator kills StaleElement). Never `cy.wait()`→`waitForTimeout()`.
- **IR + NL-in-the-middle** (ICSE'24 "Lost in Translation": raw text→text is 2–47% correct; CoT-NL +13.8%): parse source → framework-agnostic IR {actions, locators, assertions, waits, network} → generate. 15-bug taxonomy as a do-not checklist.

### P4 — Behavioral equivalence
- **Differential execution / computational accuracy** (TransCoder): run source + migrated against the same app (and faulted variants); require identical pass/fail verdicts. Disagreement = drift.
- **Fault-injection gate** (SWE-bench FAIL_TO_PASS analog): for each asserted behavior, create a faulted app variant; the migrated test MUST fail on it. A test that passes both healthy and faulted asserts nothing.
- **Execution-guided repair** (Self-Debug/Reflexion/Aider): run headless → on failure feed error + fresh snapshot back → ≤3 iterations → accept when green.

## The biggest single lever (build this)

A **generate → run → repair** loop grounded in the live app. Smallest standup:
in-process `page.ariaSnapshot()` + a headless `playwright test` run — no new
service. Concrete first build:
1. capture aria snapshot per route → grounding context;
2. generate with role>text>label>testid + multi-candidate locators;
3. validate every locator resolves UNIQUELY against the snapshot, reject otherwise;
4. RUN the spec headless against the SUT;
5. on failure, feed error + fresh snapshot to Claude (≤3 iter);
6. accept only when green + non-regressing; persist resolved locators to a manifest.

## Immediate next steps (to break the circle)
1. Add **real legacy tests targeting real public apps** to `inputs/` (saucedemo first — stable, no auth for login page).
2. Run the pipeline WITH `MIGRATION_TARGET_URL` so grounding engages (already wired: `--probe-tree`, `$DOM_GROUNDING_BLOCK`).
3. Build the **execution-validation gate**: run the migrated spec against the SUT; pass green = acceptance (the SWE-bench gate we lack).
4. Then layer mutation-kill parity (StrykerJS) and the repair loop.

Roadmap caveats from research: cy2pw is archived (fork its transforms); no deterministic Selenium→Playwright codemod exists (Selenium leans on IR+LLM).
