# ADR 0001 — Self-improvement via RAG over past completed migrations

- **Status:** Proposed
- **Date:** 2026-06-15
- **Author:** Juraj Kapusansky (`@Jurajjjjj1988`)
- **Deciders:** Repo owner (single-maintainer project)
- **Supersedes:** —
- **Superseded by:** —
- **Related:** `ROADMAP.md` (v0.5 → v1.0 prompt-tuning track), `docs/playwright-mcp-integration.md` (DOM grounding sibling), `docs/beyond-v1-research.md` §2 (Claude Code SDK rewrite)

> **TL;DR.** Stage 1 currently sends a ~21K-token static prompt (KB + rules + qa-master reference + analyze.md + input) to Sonnet on every migration without any awareness of the ~9 plans we have already shipped. Sonnet rediscovers the same locator-confidence calibration, the same KB-ID citation style, and the same hallucination-defense pin shape every single time, which is the dominant source of run-to-run variability. This ADR recommends **Option D (hybrid BM25 + dense embeddings + small reranker)**, **starting from a Phase 1 that ships Option B (pure BM25 retrieval) in a single 1-week sprint** so we can measure the lift before committing to vector infrastructure. The decision to go beyond Phase 1 is **gated on measuring at least a +0.05 absolute lift in `selectorQualityScore` or a -1 stddev reduction in run-to-run plan variance** across the calibration corpus before any vector-DB code is written.

---

## 1. Problem

### 1.1 Sonnet variability is the last big lever

Per `ROADMAP.md` "v0.5 — next" and the `MEMORY.md` `project_pwmodernizer_roadmap.md` note, **Sonnet output variability** is the largest unresolved quality slack between today's pipeline and the 70% acceptable-rate gate. The validator wall caught the deterministic failure modes (forbidden patterns, KB-ID hallucination, AST-diff triviality, qa-master conformance) — what remains is *judgement* variability:

- One run of `flaky-waits.spec.ts` proposes `getByRole('alert')` for the error banner at MED confidence with a fallback pin; another run proposes the same locator at HIGH confidence with no pin, or proposes `getByText(/invalid credentials/i)` at MED without a role hypothesis at all. None of these are wrong — they are points on a confidence-distribution shaped by Sonnet's sampling, the prompt's framing, and the literal absence of "what we usually do here." Each plan still passes the validators; each requires a slightly different human-review pass.
- Run-to-run variance shows up as a **wider distribution of `selectorQualityScore` and the `confidence histogram` axis** that `scripts/semantic-regression-check.ts` flags. The 5-axis sweep is already in place — we measure variance, we just don't have a mechanism that reduces it.

The single hypothesis this ADR tests: **feeding K most-similar past successful migrations to Stage 1 as in-context examples lowers variability and raises the first-attempt SHIP IT rate**. The hypothesis is borrowed straight from Aider's repo-map design (`References §6`), Sourcegraph Cody's RAG (`References §7`), the Karpathy-style "context is the model's working memory" framing, and arXiv 2410.10628's observation that LLM-generated test code carries 99.85% Magic-Number-Test smell that few-shot grounding measurably mitigates.

### 1.2 We are sitting on labelled examples we don't read

PWmodernizer has already produced labelled (input → plan → envelope → code → verdict) tuples for **9 inputs** as of 2026-06-15:

```
outputs/plans/
├── AddCookiesJupiterTest.java.{md, envelope.json}        # selenium-java, verify SHIP IT
├── checkout-flow.cy.js.{md, envelope.json}               # cypress, plan only (Stage 2 pending)
├── EmployeesTest.java.{md, envelope.json}                # selenium-java, multi-file
├── ExplicitWaitJupiterTest.java.{md, envelope.json}      # selenium-java, verify SHIP IT
├── flaky-waits.spec.ts.{md, envelope.json}               # bad-playwright, the canonical seed
├── FluentWaitJupiterTest.java.{md, envelope.json}        # selenium-java
├── PromptJupiterTest.java.{md, envelope.json}            # selenium-java, dialog handling
├── using_selenium_tests.py.{md, envelope.json}           # selenium-python
└── (Stage 2 outputs in outputs/tests/_legacy-v0.1.x/ for 4 of these, qa-master rewrite pending)

examples/
└── 17 expected-input/expected-plan/expected-output triples (5 bad-playwright + 5 cypress + 3 selenium-java + 2 selenium-python + 1 reference) — used today only by validate-examples.ts
```

That is roughly **9 real + 17 golden = 26 (input, plan, output) tuples** the pipeline can teach itself from. We use exactly **0** of them as in-context examples to Sonnet. The closest we come is `examples/reference/qa-master/` — but that is a *style anchor*, not a similarity-retrieved example. Every migration anchors to the same one canonical reference regardless of source framework, input shape, or anti-pattern profile.

That is the leverage. The hypothesis says: if a Cypress checkout flow lands and the next migration is *also* a Cypress checkout flow, we should be feeding the prior plan into Stage 1, not asking Sonnet to rediscover that `cy.intercept` without a stub maps to `page.route` with `fulfill` for the third time in a row.

### 1.3 What past plans look like when read by a fresh reviewer

To make the variance argument concrete: here are three (paraphrased) snippets from real past Stage 1 plans showing the same anti-pattern reasoning being rebuilt from scratch each time. Each plan was produced in a separate Sonnet invocation against a structurally similar input. The reasoning is correct in all three; the *shape* of the reasoning is slightly different in each:

- `AddCookiesJupiterTest.java.md` describes hardcoded URLs as: "URL hardcoded as absolute — should resolve via `baseURL` in `playwright.config.ts` (KB-1.1.14)."
- `EmployeesTest.java.md` describes the same anti-pattern as: "`URL = "https://hr.beacon.test/employees"` — absolute URL hardcoded at class level. Replace with `page.goto('/employees')` with `baseURL` from env via config (KB-1.1.14)."
- `PromptJupiterTest.java.md` describes it as: "`driver.get("https://bonigarcia.dev/…")` — H-severity hardcoded absolute URL. Configure `baseURL` in `playwright.config.ts`; use `page.goto('/selenium-webdriver-java/dialog-boxes.html')` (KB-1.1.14)."

Three correct reasonings, three different prose shapes, three different example specifics. A reviewer reading the second after the first sees clear shape drift even though the substance is identical. A LATER plan that retrieves the FIRST plan's reasoning has the option to converge on the SAME shape — that's the variance reduction.

The dominant LLM-as-author literature (Cody, Aider, GitHub Copilot Workspace) all converge on the same prescription for this failure mode: feed PRIOR DECISIONS to the model as authoritative context, don't make the model rederive them on every turn. PWmodernizer's 26-tuple corpus is precisely the prior-decision artefact the retrieval-augmented pattern is designed to surface.

### 1.4 Why "self-improvement" and not just "RAG"

The choice of phrasing in the ADR title matters. "Self-improvement" implies a closed loop: the system gets better as it runs, because each successful migration enriches the retrieval corpus the NEXT migration consults. This is true here — every shipped plan that lands SHIP IT after verify becomes a future retrieval candidate. The cost of this closed loop is the drift risk in §7.4 (the loop can ossify around stale patterns); the benefit is genuine compound improvement over time. Plain "RAG" framing would understate the architectural intent: retrieval here is not a one-shot context injection, it is the mechanism by which the pipeline learns from its own history.

---

## 2. Goals + non-goals

### 2.1 Goals

1. **G1 — Reduce Stage 1 run-to-run variance** measured by the 5-axis `regression-semantic.yml` sweep. Target: anti-pattern count stddev across N=5 repeated runs of the same input drops by ≥ 1 stddev. Acceptance instrument: re-run `npm run semantic:check -- --samples 5` against `inputs/bad-playwright/flaky-waits.spec.ts` with retrieval off (control) and on (treatment); paired t-test p ≤ 0.10.
2. **G2 — Raise first-attempt SHIP IT rate** on the bad-Playwright corpus from "calibrating, not yet measured" toward the 70% v1.0 gate. Target: +10 percentage points within the first 20 migrations after Phase 1 ships, attributable to retrieval per the per-migration metric in `outputs/.metrics.db`. Acceptance instrument: `metrics:report` dashboard "first-attempt SHIP IT %" trendline split by `rag_mode` column added in Phase 1's schema migration.
3. **G3 — Make the retrieval observable.** Every Stage 1 + Stage 2 invocation logs *which examples it retrieved, why, and how those examples affected the output* — readable in `npm run dashboard`. No silent black-box behaviour. Acceptance instrument: `outputs/reports/<basename>-rag.json` schema validation in `scripts/validate-rag-audit.ts` (new in Phase 1).
4. **G4 — Phase 1 must ship in one week.** Calendar week, not "estimated developer-week" — single maintainer, evenings. If the design can't ship in one week it's the wrong design. Acceptance instrument: commit log between branch creation and merge ≤ 7 calendar days.
5. **G5 — Reversibility.** Adding retrieval must be feature-flagged via a single env var (`STAGE1_RAG=on|off|shadow`) and must default to `off` until calibration data exists. Shadow mode runs retrieval but does NOT inject into the prompt, so we can measure what we *would have* retrieved before paying the token cost. Acceptance instrument: integration test where flipping the var to `off` produces an output byte-identical to the pre-Phase-1 baseline (modulo timestamp lines).
6. **G6 — No new infrastructure** for Phase 1. SQLite + ripgrep + tsx scripts only. Vector DBs, sentence-transformers, ColBERT — all gated behind Phase ≥ 2. Acceptance instrument: `package.json` diff after Phase 1 merge — no new runtime deps, only devDeps if any.
7. **G7 — Auditable cost.** Per-migration USD cost stays observable in `outputs/.metrics.db`; alerts fire if rolling 7-day mean Stage 1 cost rises by > 50% relative to the pre-Phase-1 baseline. Acceptance instrument: existing `scripts/extract-claude-usage.ts` already captures `cache_read_input_tokens` and `input_tokens` separately, so the cost split between cached prefix and dynamic retrieval is recoverable per call.
8. **G8 — Calibration parity.** Same fixture-driven calibration discipline as the 8 existing validators (`scripts/validate-examples.ts`, `kb-validate.ts`, etc.). Phase 1 ships 6 calibration fixtures, runs in `npm run calibrate`. Acceptance instrument: `tools/calibrate-pipeline/fixtures/rag-bm25/` populated; fixture matrix passes 6/6.

### 2.2 Non-goals

1. **NG1 — Fine-tuning Sonnet.** We are NOT producing a custom model. Anthropic's API does not expose a fine-tune endpoint for Sonnet 4.6 / 4.7 anyway. RAG is the entire mechanism.
2. **NG2 — Multi-turn agentic retrieval.** The retrieval happens *once* before Stage 1 invocation. No tool-calling, no agentic loops. The Claude Code SDK rewrite (`docs/beyond-v1-research.md` §2) is a separate, post-v1.0 concern.
3. **NG3 — Cross-project retrieval.** We retrieve only from THIS repo's `outputs/plans/` + `examples/`. No public-corpus retrieval (e.g. from Playwright official docs, Cypress migration guides). Phase ≥ 4 only.
4. **NG4 — Updating the knowledge-base from retrieved evidence.** RAG augments the prompt; it does NOT rewrite `config/knowledge-base.md`. KB curation stays human-gated.
5. **NG5 — Beating a measured baseline by reading more papers.** We commit to Phase 1 = pure BM25 and reject any "we should embed first because dense is more semantic" arguments until BM25's lift is measured. Phase gates are *measured numbers*, not "intuitions about retrieval quality".
6. **NG6 — Personalisation per reviewer.** No per-user retrieval profiles. Single-maintainer project; retrieval is global.
7. **NG7 — Hot-reload of retrieval at runtime.** Retrieval rebuild happens at index-build time (CI step) and at PR-merge time, NOT inside the Claude invocation. We do NOT want a "the retrieval changed mid-Stage-1" failure mode; the index is a static input to each Stage 1 invocation.
8. **NG8 — Adversarial query-side perturbation testing.** Beyond the contamination fixture in §7.1, we do not invest in red-team / prompt-injection hardening of the retrieval pipeline. The corpus is internal; the queries are derived from internal source code; the attack surface is the same as Stage 0 secret scanning (already covered).

---

## 3. Current state survey

### 3.1 What Stage 1 sends to Sonnet today

Reading the active workflow (`.github/workflows/plan.yml` line 618 — `claude --model claude-sonnet-4-6 ...`) and the assembled prompt (`prompts/_assembled/analyze.md` — 34,291 bytes / ~9K tokens after `prompts/_fragments/` expansion via `scripts/assemble-prompts.ts`):

| Component                                       | Bytes        | ~Tokens     | Source                                                                            | Cacheable?              |
|-------------------------------------------------|--------------|-------------|-----------------------------------------------------------------------------------|-------------------------|
| `config/knowledge-base.md`                      | 147,506      | ~37K        | static, 125 KB IDs across 4 frameworks                                            | Yes (Anthropic cache_control) |
| `config/migration-rules.md`                     | 39,099       | ~10K        | static, 85 rules                                                                  | Yes                     |
| `prompts/_assembled/analyze.md`                 | 34,291       | ~9K         | static after `assemble-prompts.ts`                                                | Yes                     |
| `examples/reference/qa-master/` style anchor    | ~25,000      | ~6K         | snapshot, owner-permitted; Sonnet reads selected files                            | Yes                     |
| Input file (the test being migrated)            | 500 – 25,000 | ~0.1K – 6K  | dynamic                                                                           | No                      |
| Plan + envelope deliverables (output, written)  | n/a          | n/a         | written via Write tool                                                            | n/a                     |
| **Total Stage 1 input**                         | **~250K**    | **~62K**    | (~60K cacheable, ~2K dynamic)                                                     |                         |

NVIDIA RULER's degradation threshold for Claude's 1M context starts to bite past ~50% of the advertised window (~500K tokens for 1M-context Sonnet 4.6). At 62K we are nowhere near the cliff. **There is ~440K of headroom** for retrieved-context injection before degradation becomes a primary concern, and ~25K of headroom before we hit Stage 0's `200B ≤ input ≤ 25K tokens` input gate (which is a *separate* gate on the source file only — the prompt budget is uncapped). That headroom is the resource RAG would spend.

Stage 2's `prompts/_assembled/generate.md` is even larger (45,478 bytes / ~11K tokens) — total Stage 2 input is ~75K tokens before retrieval, leaving similar headroom. Stage 2 also reads the plan + envelope + snippet inventory + raw input, so dynamic content is already 4–10× larger than Stage 1's dynamic slice; retrieval at Stage 2 displaces less of the static prefix proportionally.

**Cache hit-rate today.** Per `scripts/extract-claude-usage.ts` extraction of `usage.cache_read_input_tokens` from `/tmp/claude-events.ndjson`, our observed Sonnet 4.6 cache-read fraction on Stage 1 invocations is ~70–85% (varies by which fragment was last edited; an `assemble-prompts.ts --write` invalidates the cache). Adding ~5K tokens of dynamic retrieval context pushes the cache-hit fraction down to ~65–80%; the absolute Stage 1 USD cost rises 30–40% (already captured in §5.2's "$0.018 / migration" Δ math). The cache headroom matters because at $3/M input tokens uncached vs $0.30/M cached, we want as much of the prompt as possible to live in the cacheable prefix; retrieved context cannot, by definition, sit there.

### 3.2 What `scripts/build-inventory.ts` currently does

The script enumerates existing POMs / fixtures / helpers under `outputs/tests/{pages,fixtures,helpers}` (legacy v0.1.x paths) and `outputs/helper/` (v0.2.0 qa-master paths) into a compact markdown blob injected into Stage 2's prompt — `outputs/.snippets-inventory.md`. Key design notes from re-reading the script:

- **Pattern: Aider repo-map / Sourcegraph Cody RAG** — extract module-level surface (class names, public method signatures, fixture shapes from `extend<{...}>`), not full file bodies. Compact representation of "what code already exists you should reuse."
- **Caps + pruning.** Per-category mtime-pruning at 60 / 25 / 60 entries (POMs / fixtures / helpers). The comments call out Sonnet's degradation past ~150 inventory lines.
- **SHA-256 cache.** Re-runs that don't change source files skip the rebuild entirely via a hash marker in the header.
- **No similarity ranking.** The inventory is alphabetical by path. Sonnet sees ALL helpers within the cap, not just the ones likely to be relevant to the current migration.
- **Stage 1 doesn't get an inventory.** Only Stage 2 reads `outputs/.snippets-inventory.md`. Stage 1's prompt is static modulo the input file.

The inventory is the **closest analogue to retrieval the pipeline currently has** — and a good baseline shape for Phase 1 of this ADR's retrieval. The lessons (compact representation, deterministic caching, observable pruning) carry directly.

**Concretely, the carryover surface from `build-inventory.ts` to this ADR's Phase 1 retrieval scripts:**

| Inventory script invariant | Phase 1 retrieval script reuses                                                                  |
|----------------------------|--------------------------------------------------------------------------------------------------|
| `<!-- source-sha256: … -->` cache marker header | Same marker shape on `outputs/.rag-index.json` to skip re-index on no-source-change runs. |
| `findFiles` + `capByMtime` for per-category capping | Same primitives for capping retrieval-result lists per framework bucket.            |
| `repoRelative` for stable repo-relative paths | Same — retrieved IDs are repo-relative paths joined to a verdict + KB-ID summary.       |
| GitHub Actions `::error file=...` annotations on parse failure | Same — bad plans surface as actionable annotations on the workflow run. |
| `parseCap` CLI contract (`--max-poms 60` style) | Mirrored as `--max-retrieval 3` etc.                                                  |

The retrieval scripts inherit the inventory's "deterministic, cacheable, ts-morph-where-needed, walk-then-emit" shape — operator mental model carries.

### 3.3 What `outputs/plans/` looks like per completed migration

A real per-migration footprint, measured from the 9 plans on disk as of 2026-06-15:

| File                        | LOC range observed | Median | Purpose                                                          |
|-----------------------------|--------------------|--------|------------------------------------------------------------------|
| `<basename>.md`             | 158 – 305          | 203    | human-reviewable plan (anti-patterns table, locator table, pins, open questions, risks) |
| `<basename>.envelope.json`  | 33 – 224           | 59     | machine contract (scenarios + locator table + required\* arrays) |
| `<basename>.spec.ts` (output) | 22 – 75          | ~45    | the migrated spec (4 legacy outputs at `outputs/tests/_legacy-v0.1.x/`, qa-master rewrites pending) |
| `<basename>.md` report       | 48                | 48     | per-migration metrics + confidence breakdown                     |

Example anatomy of one tuple (`flaky-waits.spec.ts`):

- **Input** (`inputs/bad-playwright/flaky-waits.spec.ts`, 39 LOC): `test.describe` nested 2 deep, 5 `waitForTimeout` calls, 4 CSS/id locators, 1 if/else conditional asserting test outcome.
- **Plan** (`outputs/plans/flaky-waits.spec.ts.md`, 169 LOC): 14-row anti-pattern table citing 5 KB IDs, 5-row locator translation table, 4 hallucination-defense pins, 10 open questions, 6 risk callouts, expected metrics table.
- **Envelope** (`outputs/plans/flaky-waits.spec.ts.envelope.json`, 66 LOC): 2 scenarios (`1.1` happy path, `1.2` invalid password), 5-entry locator table, `subtractive: true`.
- **Expected output** (`examples/bad-playwright-01-flaky-waits/expected-output.spec.ts`, 33 LOC): 2 tests under `test.describe('Acme Shop login')`, web-first assertions via `expect(getByRole('alert')).toHaveText(/invalid credentials/i)`, no hard waits, baseURL via `goto('/login')`.

That tuple is **dense, structured, and labelled** — KB IDs in the plan cite a known taxonomy; the envelope is JSON-validatable; the verify verdict (when present) labels SHIP IT / FIX FIRST / START OVER. This is the corpus RAG would retrieve over.

**Per-framework coverage of the 9-real + 17-golden corpus, by source framework:**

| Source framework   | Real (`outputs/plans/`) | Golden (`examples/`) | Verify SHIP IT in `outputs/reports/` | Total retrieval-eligible |
|--------------------|-------------------------|----------------------|--------------------------------------|--------------------------|
| bad-playwright     | 1 (flaky-waits)         | 5                    | 0 reports yet (canonical seed)       | 6                        |
| cypress            | 1 (checkout-flow)       | 5                    | 0 (Stage 2 pending)                  | 6                        |
| selenium-java      | 5 (Employees, Prompt, AddCookies, ExplicitWait, FluentWait) | 3 | 3 SHIP IT (AddCookies, ExplicitWait, FluentWait) | 8 |
| selenium-python    | 1 (using_selenium_tests) | 2                   | 1 SHIP IT                            | 4                        |
| reference (style anchor) | n/a               | 1 (qa-master)        | n/a                                  | 1 (qa-master is style-only, NOT a retrieval candidate) |
| **Total**          | **8 plans**             | **15 golden**        | **4 SHIP IT**                        | **24 retrieval-eligible** |

Selenium-java dominates the corpus today (6 plans + 3 golden = 8 retrieval-eligible). bad-Playwright (the v0.5 quality bar) has only 6 entries to retrieve from. **The cross-framework retrieval bridge — using shared KB IDs to retrieve a Cypress plan when handling a Selenium plan with the same anti-pattern category — is the only way to get retrieval working for bad-Playwright early.** Phase 1's BM25 over KB IDs (not raw source tokens) is designed precisely for this; without it bad-Playwright migrations would retrieve only against 6 documents until corpus growth catches up.

### 3.4 What's already labelled vs what's still raw

| Signal                     | Available now?                       | Source                                          |
|----------------------------|--------------------------------------|-------------------------------------------------|
| Source framework           | Yes (envelope `sourceFramework`)     | `outputs/plans/*.envelope.json`                 |
| Anti-pattern KB IDs cited  | Yes (parseable from plan markdown)   | `outputs/plans/*.md`                            |
| Scenario IDs + descriptions| Yes (envelope `scenarios[]`)         | `outputs/plans/*.envelope.json`                 |
| Locator confidence histogram | Yes (envelope `locatorTable[].confidence`) | `outputs/plans/*.envelope.json`           |
| Verify verdict             | Partial (4 of 9; `outputs/reports/*.md`) | `outputs/reports/*.md`                      |
| Aggregate confidence       | Yes for 4 of 9                       | `outputs/reports/*.md` "Aggregate confidence:"  |
| Per-axis semantic regression | Yes via `npm run metrics:report`   | `outputs/.metrics.db` (3 tables)                |
| Embedding vector           | **No**                               | not computed today                              |

Phase 1 retrieval keys off `sourceFramework`, anti-pattern KB IDs, and (parseable) locator-table shape — all already on disk. **No new labelling pass is required to ship Phase 1.**

### 3.5 What the canonical migration walkthrough teaches us about variance

`docs/walkthrough.md` describes the PromptJupiterTest migration that closed the v0.2.0 calibration loop in **11 prompt+validator+workflow iterations**. The variance Sonnet exhibited across those 11 attempts is the same kind retrieval would suppress: locator-confidence drifted between MED and HIGH for the `#my-prompt` element across runs; pin shape varied between "two-line" and "five-line" prose styles; structural-decisions §5 sometimes proposed a POM, sometimes didn't, on the same input.

If those 11 runs had been able to retrieve a successful past PromptJupiterTest-shaped migration (had one existed earlier), the closure would plausibly have taken 3–5 iterations instead of 11. That's a 50–70% reduction in calibration cost on a single closure. Scaled across the next ~20 expected calibration closures (one per real input migration), Phase 1 has a realistic upper-bound impact on total project velocity worth quantifying.

### 3.6 Verified parseability of the labelled signals

A quick `grep -n "KB-[0-9]" outputs/plans/*.md` shows every plan cites 5-20 KB IDs in its anti-pattern table, in a format that's a one-line regex parse (`/^\| .* \| KB-([0-9.]+) \|/`). Envelope JSON is by-construction parseable. Verify verdicts in `outputs/reports/*.md` follow the canonical `Aggregate confidence: 0.NN` + `Verdict: **SHIP IT**` shape (commit `0c9f234` standardisation per ROADMAP). All the structured fields Phase 1 needs are recoverable from disk with shell tools, no LLM parsing pass needed. This is the underrated practical advantage of having already built the pipeline before retrieving from its output: the labels exist because the validators required them.

---

## 4. Architectural options

Four options compared. Each is a complete answer to "how does Stage 1 retrieve relevant past migrations before invoking Sonnet."

### 4.1 Option A — Static few-shot in prompts

Pick 1–3 canonical past migrations by hand, paste them into `prompts/_assembled/analyze.md` as worked examples, and update them quarterly. Zero retrieval at runtime.

| Aspect              | Detail                                                                                                 |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **Pros**            | Zero new infra; uses Anthropic prompt caching at 0.1× (cacheable as part of the static suffix); easiest to debug — example is literally in the prompt; calibration-friendly via existing `regression-semantic.yml`. |
| **Cons**            | Bias toward whatever was selected — every migration sees the same 3 examples regardless of input shape; staleness — quarterly refresh is human burden + risk of forgotten refresh; no per-framework specialisation — a Cypress input gets the same example as a Selenium Java input; gives up the entire "use what we've shipped" leverage. |
| **Indicative cost** | $0 incremental per migration (cache already covers it). Implementation cost: ~20 LOC in `prompts/_assembled/analyze.md` + 3 file copies. |
| **Implementation LOC** | ~50 (prompt edits + a `scripts/refresh-few-shot.ts` curation script).                              |
| **Latency**         | +0 ms (already in the cached prefix).                                                                  |
| **Maintenance burden** | Quarterly human curation. ~1 hr per quarter. High forgetting risk.                                 |
| **Calibration**     | Existing `regression-semantic.yml` measures the lift (or lack of) directly.                            |
| **Verdict in this ADR** | **Phase 0 / baseline.** Treat as the floor that retrieval must beat. Ship the 3 canonical examples first so we have a control. |

**Specifics if we shipped A alone:** the 3 canonical anchors would be (a) `examples/bad-playwright-01-flaky-waits/expected-plan.md` (the canonical subtractive migration), (b) `examples/cypress-01-login-flow/expected-plan.md` (the canonical cross-framework happy-path), (c) `examples/selenium-java-03-multifile-login/expected-plan.md` (the canonical multi-file Selenium case). Total static cost: ~3 × 200 LOC × ~5 tokens/line = ~3K tokens added to the cacheable prefix. This is the cheapest option on the table and **we ship it as part of Phase 1 anyway** — the BM25 retrieval is in addition to, not instead of, the static anchors.

### 4.2 Option B — Lexical retrieval (BM25 / ripgrep)

Build a small Node-side BM25 index over `outputs/plans/*.md` + `examples/*/expected-plan.md`, score each candidate against a query built from the current input file (anti-pattern tokens + source-framework + extracted locator strings), retrieve top-K with K ∈ {1, 3, 5}, format the retrieved plans into a compact context block injected into Stage 1's prompt.

| Aspect              | Detail                                                                                                 |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **Pros**            | No vector DB; no embedding API call; no Python dependency; ripgrep-fast on N=9–100 corpora; existing tsx-script style matches `build-inventory.ts`; deterministic — same input always retrieves same top-K; cheap to A/B (env-var-flagged); naturally surfaces shared KB-ID overlap (e.g., a new test with `cy.wait`+`cy.intercept` retrieves Cypress checkout flow because both plans mention `KB-1.2.7` + `KB-1.2.1`). |
| **Cons**            | Lexical mismatch — Selenium Java's `Thread.sleep` won't BM25-match Cypress's `cy.wait` even though both are KB-1.x.1 hard waits; sensitive to tokenizer choice; no synonym handling; can't capture structural similarity ("this is a multi-step funnel test" vs "this is a single-button click test"); recall degrades as corpus grows past ~500 entries. |
| **Indicative cost** | ~$0.005 / migration token cost (retrieved context adds ~2–5K tokens to the input); $0 infra cost.      |
| **Implementation LOC** | ~250–350 (1 `scripts/retrieval-bm25.ts` + 1 `scripts/index-plans.ts` builder + 1 calibration script + JSON-cached index file + plan.yml step wiring). |
| **Latency**         | <50 ms for N≤100 (in-memory index loaded from JSON cache).                                             |
| **Maintenance burden** | Rebuild index on commits touching `outputs/plans/` or `examples/`; trivially CI-cached. ~1 hr / quarter to tune k1, b parameters. |
| **Calibration**     | Run on the 17 golden examples as a held-out set: retrieval should prefer same-framework over cross-framework neighbors, MAP@3 target ≥ 0.6. |
| **Verdict in this ADR** | **Phase 1 ship.** Highest yield-per-LOC; we can measure the lift cheaply before any vector commitment. |

**Specifics on the BM25 implementation choice:** we will *not* depend on Elasticsearch / Lucene server processes. Concrete choice: bundle the pure-JS package `wink-bm25-text-search` (~12 KB minified, MIT-licensed, last release 2024 — still active in 2026) inside `scripts/retrieval-bm25.ts`, or implement the BM25 scoring formula directly (it is ~30 LOC: term-frequency × IDF × `(k1+1) / (k1 × (1-b + b × |d|/avg|D|) + tf)`). We prefer the inline implementation because (a) no new dep on `package.json`, (b) total LOC is small, (c) we control the tokenizer (especially around KB-ID preservation — naive tokenizers split `KB-1.1.1` on the dots). Inline tokenizer rules: lowercase, strip non-`[a-z0-9\-./]`, keep `kb-1.1.1` as a single token, keep `getbyrole` / `getbylabel` etc. as single tokens (don't split on camelCase), framework names (`bad-playwright`, `cypress`, `selenium-java`, `selenium-python`) stay whole tokens with high IDF weight.

### 4.3 Option C — Dense embeddings + local vector DB (LanceDB or sqlite-vss)

Pick an embedding model (Voyage AI's `voyage-code-3`, or OpenAI `text-embedding-3-small`, or local `Xenova/all-MiniLM-L6-v2` via Transformers.js), compute one embedding per plan + per envelope at build time, store in `outputs/.rag.lance` (LanceDB) or `outputs/.rag.sqlite` (sqlite-vss extension), at query time embed the current input and pull top-K by cosine.

| Aspect              | Detail                                                                                                 |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **Pros**            | Captures semantic similarity across frameworks ("hard wait" matches Cypress + Selenium + bad-Playwright all at once); standard pattern (well-documented in 2025–2026 literature); LanceDB benchmarks show <10 ms query at our scale; embeddings can be cached and only invalidated on file change. |
| **Cons**            | New dep — either an API key (Voyage / OpenAI billing surface) or a 90MB local model + ONNX runtime (Transformers.js); two new files per migration to maintain (the embedding + the index); cold-start cost — first migration after model swap re-embeds everything; sqlite-vss is a C extension, Node binding maturity varies (Phase 2 risk); embedding choice locks in a quality ceiling we may discover only after K migrations. |
| **Indicative cost** | Voyage `voyage-code-3` at $0.18/M tokens: ~$0.001 / migration. Local Transformers.js: $0 + ~200ms cold-start latency. Index storage: ~10 MB at N=100. |
| **Implementation LOC** | ~400–600 (model wrapper + index builder + query path + LanceDB or sqlite-vss bindings + cache invalidation + fallback when embedding fails).         |
| **Latency**         | 50–500 ms (depends on whether the embedding step runs locally or via API; local cold-start dominates). |
| **Maintenance burden** | Re-embed on KB taxonomy revision (drift mitigation per §7.4); model-pin governance; dep-bump pain when embedding lib changes API. |
| **Calibration**     | Same held-out test as Option B; expected MAP@3 ≥ 0.75; *must* beat Option B by ≥ 5 percentage points to justify the infra. |
| **Verdict in this ADR** | **Phase ≥ 2, conditional.** Only ship if Phase 1 measurement shows BM25 plateauing before the 70% gate is hit. |

**Specifics on embedding-model choice when Phase 3 ships:**

- **Preferred:** Voyage AI `voyage-code-3` (3072-dim, code-specialised, 32K context, $0.18/M input tokens). Reason: code-specialised model handles `cy.intercept` ≈ `page.route` semantic similarity better than general-text models (per Voyage's own MTEB-Code benchmark scores). API-based, so no local model weight to ship in CI.
- **Local fallback:** `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers` (Transformers.js) — 384-dim, 90 MB ONNX, $0 cost, runs in Node natively. Quality gap vs Voyage is real (~5–10 pp MAP@10 on similar tasks) but acceptable for the offline/no-secrets-available fallback path.
- **Rejected:** OpenAI `text-embedding-3-small` ($0.02/M, 1536-dim) — better-than-MiniLM general embedding but worse than Voyage on code. Adding OpenAI as a dependency duplicates the existing Anthropic billing surface and creates a second secret to rotate (`OPENAI_API_KEY` in addition to `CLAUDE_CODE_OAUTH_TOKEN`); reject on operational-surface grounds, not quality.
- **Vector store choice (LanceDB vs sqlite-vss):** LanceDB wins on Node-binding maturity (Apache Arrow + Lance file format, native Node bindings since 0.4.x; sqlite-vss requires `better-sqlite3` + C extension load that's fragile in GitHub Actions runners). Both store ~10 MB at our scale.

### 4.4 Option D — Hybrid (BM25 + dense + lightweight reranker)

Run BM25 (Option B) and dense (Option C) in parallel, take the union of top-K-each, then rerank with a small cross-encoder (e.g., `cross-encoder/ms-marco-MiniLM-L-6-v2` via Transformers.js — 22 MB ONNX) or with a Reciprocal Rank Fusion (RRF) heuristic. Inject the reranked top-K into Stage 1.

| Aspect              | Detail                                                                                                 |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **Pros**            | Best published retrieval quality (RRF + cross-encoder consistently beats either alone on BEIR-style benchmarks); robust to corpus-size variance — BM25 wins on small/exact queries, dense wins on paraphrased queries; rerank adds the final "is this actually a good neighbor for THIS query" signal. |
| **Cons**            | All of C's downsides plus reranker dep + 2× memory at query time + extra ~100 ms latency; substantial LOC + test surface; for N=9 today the rerank signal is noise — the math says hybrid wins at N ≥ 1000. |
| **Indicative cost** | $0.001 / migration (same as C) + reranker $0.                                                          |
| **Implementation LOC** | ~600–900 across 4 scripts.                                                                          |
| **Latency**         | 150–700 ms.                                                                                            |
| **Maintenance burden** | Highest — three moving parts (BM25, dense, reranker), each with its own version-pin + tune cycle. |
| **Calibration**     | Expected MAP@3 ≥ 0.85 but only meaningful at N ≥ 100.                                                  |
| **Verdict in this ADR** | **Phase ≥ 3, conditional and corpus-size-gated.** Only ship if (a) corpus reaches ≥ 100 migrations AND (b) Phase 2 dense beats Phase 1 BM25 by < 10 pp (i.e., dense alone is leaving lift on the table). |

### 4.5 Side-by-side scoreboard

| Criterion                | A: Static few-shot | B: BM25     | C: Dense    | D: Hybrid   |
|--------------------------|--------------------|-------------|-------------|-------------|
| Phase-1 feasibility      | Trivial            | **1 week**  | 2–3 weeks   | 4–6 weeks   |
| New infra                | None               | None        | 1 dep + DB  | 2 deps + DB |
| Per-migration $          | $0                 | $0          | ~$0.001     | ~$0.001     |
| Query latency            | 0 ms               | <50 ms      | 50–500 ms   | 150–700 ms  |
| Quality ceiling          | Low                | Medium      | High        | Highest     |
| Maintenance              | Quarterly          | Quarterly   | Per-model   | Highest     |
| Debuggability            | Trivial            | High        | Medium      | Low         |
| Determinism              | Total              | Total       | Total*      | Total*      |
| Calibration corpus today | Yes (3 files)      | **Yes (26 tuples)** | Yes (26 tuples) | No (N<100) |

\* Embedding models are deterministic given fixed input + version; reranker likewise. Output stochasticity is fully on Sonnet, not retrieval.

---

## 5. Recommended option + rationale

### 5.1 Recommendation: ship **Phase 1 = Option B (BM25)**, with explicit gates to escalate to D if measurement demands it

We pick BM25 first because:

1. **It is the only option that can ship in 1 week** and still have time for calibration. G4 (one-week Phase 1) is non-negotiable; A is trivial-but-low-yield, C requires picking an embedding model and reviewing the Node-bindings story, D is C + more.
2. **It uses the corpus we already have, without new labelling.** N=26 tuples (9 real + 17 golden) are tagged with `sourceFramework`, KB IDs, locator-table shape — BM25 retrieves on those directly. Dense gives us nothing extra at N=26 that BM25's lexical overlap doesn't already give us (the literature consensus is that dense pulls ahead at N ≥ ~1,000 docs).
3. **It is reversible.** Single env-var flag (`STAGE1_RAG=on|off|shadow`); a bad week of measurement means we set it `off` and our Stage 1 cost goes back to today's baseline. C and D would carry an embedding-DB on disk we'd then have to deprecate.
4. **It produces measurement data the dense option cannot produce in advance.** Once we know BM25's lift in absolute pp, we know whether dense's marginal lift is worth its infra cost. Without Phase 1 we are guessing.
5. **It matches the existing architecture's grain.** `build-inventory.ts` is already an Aider-repo-map-style scan-and-rank pipeline with SHA-256 caching, mtime pruning, and a deterministic markdown render. BM25 retrieval slots into the same script style and reviewer mental model.
6. **It is honest about what we don't know.** Dense embedding requires committing to a model family before we have data on whether retrieval at our scale helps at all. BM25 is the cheaper experiment with the lower opportunity cost — if it fails, we have learned something useful (retrieval at this scale doesn't add lift) without having shipped infrastructure we then need to deprecate.
7. **It is teachable.** A new contributor (or a future me, six months from now) can read `scripts/retrieval-bm25.ts` and understand it end-to-end in 15 minutes. The dense path requires understanding embedding-model behaviour + vector-DB internals + ANN index trade-offs; that's a higher onboarding cost we don't need to pay until we have evidence the cost buys lift.

### 5.2 Counter-arguments addressed with numbers

> **"Dense will win, just ship it directly."**
> The published gap between BM25 and dense at small corpora (N < 500 docs) is 2–8 percentage points MAP@10 in favour of dense (ColBERT paper §6 + BEIR benchmark Table 3). Our held-out set is 17 docs. The expected lift of dense over BM25 at our scale is ≈ 0–3 pp, *inside the noise floor of our N=5 semantic regression sweep*. The infra cost is 1 week minimum + ongoing dep maintenance. The right call is to measure BM25 first, then revisit if measurement shows BM25 plateauing.

> **"Lexical mismatch across frameworks (Cypress `cy.wait` vs Selenium `Thread.sleep`) will hurt retrieval quality."**
> True for the raw input file. Mitigation: we BM25 against the *plan markdown* + *KB IDs cited*, not the raw source. A bad-Playwright `waitForTimeout` and a Selenium `Thread.sleep` plan both cite `KB-1.1.1` / `KB-1.3.1` and both contain "hard wait" prose. The shared KB-ID vocabulary gives BM25 the cross-framework bridge dense would otherwise be the only candidate to provide. We index the plan, query partly with the input, partly with a quick Stage-0 anti-pattern fingerprint (see §6 Phase 1 details).

> **"K=3 retrieved plans inflates Stage 1 prompt by 3× the median plan size = ~600 LOC = ~6K tokens — significant cost."**
> Cache impact: retrieved plans are dynamic, so they sit in the uncached portion of the prompt. At Anthropic's Sonnet input price (~$3/M tokens) and our ~$0.05 Stage 1 baseline, +6K tokens = +$0.018 per migration — a ~40% Stage 1 cost increase. Acceptable cost ceiling: $0.55 total / migration per `README.md` "Costs" section. New total Stage 1: $0.068, total per migration: ~$0.20–0.65. Well under ceiling. Phase 1 default K=3 is conservative; calibration tunes K downward if cost matters more than recall.

> **"What if retrieved examples contain bad patterns that contaminate the new plan?"**
> Real risk; see §7.1 mitigation. Phase 1 filters retrieval to plans whose `outputs/reports/*.md` verdict (when present) is SHIP IT, and explicitly excludes plans flagged `migrator:plan` but still pending verify. The 17 golden examples are by construction good. We retrieve only from filtered candidates.

> **"Static few-shot (Option A) is even cheaper than B."**
> Yes. But A is a *fixed* improvement that becomes our prompt-baseline, not a self-improving mechanism. Phase 1 should add A's 3 canonical static examples (low-hanging fruit, ~50 LOC change) AND ship the BM25 retrieval pipeline. The two compose — static gives Sonnet the canonical shape, retrieved gives Sonnet the per-input-relevant example.

> **"BM25 over plan markdown is a strange choice — markdown is not source code."**
> Intentional. Markdown plans are the densest, most-labelled summary of "what the previous plan decided about this anti-pattern" — denser than the raw input AND denser than the generated output. They contain the KB-IDs explicitly cited, the locator-confidence histogram in tabular form, the open-questions enumeration, and the structural decisions. Retrieving the markdown gives Sonnet the WHY; retrieving the source would give Sonnet the WHAT (and force re-derivation of the WHY at every Stage 1 call). The choice maps to Aider's repo-map philosophy: retrieve the surface, not the body.

> **"Why not just retrieve the expected-output spec files instead of plans?"**
> Because the expected output is the answer; the plan is the reasoning. We want Sonnet to learn the reasoning shape, not memorise specific outputs. Retrieving the spec would teach Sonnet "produce code that looks like X"; retrieving the plan teaches Sonnet "decide locator confidence the way the prior reviewer did when faced with anti-patterns A, B, C." Phase 2 retrieves *both* (plan + spec) for Stage 2 because at code-generation time the spec IS the appropriate teaching signal.

> **"BM25 is sensitive to corpus growth — what about when we have 200 plans?"**
> BM25 IDF naturally down-weights common terms as corpus grows. At N=24 today, common terms ("locator", "expect", "page") have low IDF; rare terms (KB-ID strings, specific framework tokens) carry the score. At N=200, the same dynamic holds — actually IMPROVES, because common terms get more aggressively down-weighted and discriminative tokens stand out more. Phase 1 design is corpus-size-stable up to the ~1K BM25 inflection point identified in BEIR. Phase 3 dense escalation is the response to crossing that point.

> **"What about negative retrieval — surfacing 'don't do what THIS plan did' examples?"**
> Excluded from Phase 1 explicitly. Negative few-shot is a known LLM failure mode (Sonnet may parse the "don't" weakly and replicate the negative example). Phase 2 considers negative retrieval gated behind explicit prompt-engineering that frames retrieved-bad examples as labelled anti-instances — but the design + measurement burden is high. Default is positive-only retrieval.

---

## 6. Implementation phases

### Phase 1 — BM25 retrieval + static few-shot anchor (target: 1 week)

**Ships:**

- `scripts/index-plans.ts` — walks `outputs/plans/*.{md,envelope.json}` + `examples/*/expected-plan.md` + `examples/*/expected-plan.envelope.json`, parses out (a) `sourceFramework`, (b) verify verdict from `outputs/reports/<basename>.md` if present, (c) anti-pattern KB IDs from the plan markdown (regex over `\| KB-[\d\.]+`), (d) locator-confidence histogram from envelope, (e) raw plan body. Writes a deterministic `outputs/.rag-index.json` with SHA-256 marker (same caching pattern as `build-inventory.ts`).
- `scripts/retrieval-bm25.ts` — implements BM25 (k1=1.5, b=0.75 defaults from Lucene) over the indexed documents. Query construction: tokenize the input file's filename + framework hint (file extension) + a quick Stage-0-style anti-pattern fingerprint (regex over `waitForTimeout|Thread.sleep|cy.wait|cy.intercept|@FindBy|By\.\w+`). Filter candidates: SHIP IT verdict OR golden example. Returns top-K with `{id, score, framework, kbIds, verdict, planExcerpt}`.
- `scripts/rag-context-render.ts` — formats top-K into a compact markdown block (~150–500 LOC per retrieved plan, anti-pattern table + locator table + open-questions sample only; full plan available via citation). Embedded in `prompts/_assembled/analyze.md` after the qa-master style anchor via a new `<!-- include-begin: rag-context -->` fragment marker that is empty unless the retrieval step wrote it.
- 3 static few-shot anchors added to `prompts/_fragments/few-shot-canonical.md` (one bad-Playwright, one Cypress, one Selenium Java) included into `prompts/_assembled/analyze.md` unconditionally; cached in the prompt prefix.
- `plan.yml` wiring: after Stage 0 sanity gate and before `claude --print`, run `npx tsx scripts/retrieval-bm25.ts --input "$INPUT_PATH" --out outputs/.rag-context.md --shadow $STAGE1_RAG`. Shadow mode (`STAGE1_RAG=shadow`) writes the retrieval output to a side-file for measurement but does NOT inject. Live mode (`STAGE1_RAG=on`) injects.
- `outputs/.metrics.db` schema migration: add `rag_retrieved_ids TEXT, rag_score REAL, rag_mode TEXT` to the `plans` table. Dashboard gains a "RAG retrieval" panel showing per-migration retrieved-IDs + score.
- 6 fixture-driven calibration tests in `tools/calibrate-pipeline/fixtures/rag-bm25/`: cross-framework recall (Selenium plan retrieves Selenium first), anti-pattern overlap recall (KB-1.1.1-citing plan retrieves another KB-1.1.1-citing plan first), and three negative-case fixtures.

**Success metric:**

- Held-out MAP@3 ≥ 0.6 over the 17 golden examples (leave-one-out evaluation).
- `scripts/semantic-regression-check.ts` 5-axis sweep run N=5 with `STAGE1_RAG=shadow` to capture baseline, then N=5 with `STAGE1_RAG=on` to capture lift. Stddev of `antiPatternTotal` drops by ≥ 1 (this is the variance target G1).
- Per-migration USD cost stays under $0.07 for Stage 1.

**Exit criteria (must hit all to advance to Phase 2):**

- Shadow→on lift is ≥ +0.05 absolute on `selectorQualityScore` OR -1 stddev on the variance axis. If neither, STOP and re-examine the design — going to dense vectors won't help if BM25 didn't.
- No regression on `npm run smoke` or `regression-test.yml` matrix.
- Dangerfile clean.

**Day-by-day breakdown for the 1-week sprint** (evenings, ~3 hr/day):

| Day | Deliverable                                                                                              |
|-----|----------------------------------------------------------------------------------------------------------|
| Mon | `scripts/index-plans.ts` skeleton — walk + parse + write `outputs/.rag-index.json` (no scoring yet).      |
| Tue | `scripts/retrieval-bm25.ts` — inline BM25 scorer + tokenizer + top-K selection + JSON output.             |
| Wed | `scripts/rag-context-render.ts` + `prompts/_fragments/{rag-context,few-shot-canonical}.md` + assemble.    |
| Thu | `plan.yml` wiring; `STAGE1_RAG=shadow` default; `outputs/.metrics.db` migration + dashboard panel.        |
| Fri | 6 fixture calibration tests + leave-one-out MAP@3 evaluator over the 17 golden examples; tune k1, b.      |
| Sat | Shadow-mode runs against the 6 inputs already in `inputs/bad-playwright/` — measure retrieval correctness. |
| Sun | Flip `STAGE1_RAG=on` for 3 inputs; measure variance against shadow baseline; write PR description.        |

### Phase 2 — Verdict-weighted retrieval + Stage 2 RAG (target: 2 weeks after Phase 1 ships)

**Ships (conditional on Phase 1 exit criteria met):**

- BM25 scoring weighted by verify verdict — SHIP IT plans get 1.2× weight, FIX FIRST get 0.8×, START OVER excluded. Migration-rules drift detection (§7.4) auto-decays plans older than the current `config/knowledge-base.md` git revision.
- Stage 2 RAG: same retrieval pipeline runs ahead of `migrate.yml`'s Claude call, retrieves the *plan + generated output* pair (so Stage 2 sees "here's a similar plan that landed THIS specific code shape"). Format reuses Stage 1 renderer.
- `scripts/track-output-variability.ts` extended to compare per-migration output diff variance across runs with and without retrieval. Goal: tighten the distribution.
- Dashboard panel shows retrieved-tuple count, hit-rate, and per-framework retrieval quality.

**Success metric:** First-attempt SHIP IT rate +5 pp over Phase 1 baseline. Stage 2 confidence variance drops by ≥ 1 stddev.

**Exit criteria for Phase 3 escalation:** BM25 MAP@3 plateaus below 0.75 across N≥20 real migrations.

**Concrete Phase 2 deliverables:**

- `scripts/retrieval-bm25.ts` learns the `--verdict-weight` flag; index loader honours decay factor per §7.4 drift math.
- `migrate.yml` gains the same `STAGE2_RAG=on|off|shadow` env-var-gated retrieval step that `plan.yml` got in Phase 1; same `outputs/.rag-context-stage2.md` artifact (different file from Stage 1's because the queries differ — Stage 2 queries the *approved plan* not the raw input).
- `tools/calibrate-pipeline/fixtures/rag-bm25-stage2/` — 6 fixtures pairing a plan with its expected retrieval set.
- `scripts/persist-plan-metrics.ts` extended to record retrieval-attribution: per-migration "did the retrieved plan's KB IDs appear in the new plan?" boolean; aggregate-roll-up surfaces "retrieval value index" on dashboard.

### Phase 3 — Dense embedding overlay (Option C) — conditional, target: 1 sprint when triggered

**Ships (only if Phase 2 exit criteria met):**

- Pick embedding: `voyage-code-3` via Voyage API (no local model dep; predictable cost) — guarded by `VOYAGE_API_KEY` secret. Local fallback: `Xenova/all-MiniLM-L6-v2` via Transformers.js (cold-start cost in CI).
- LanceDB (preferred over sqlite-vss for Node ergonomics — sqlite-vss is a C extension, LanceDB ships a pure Node binding) at `outputs/.rag.lance`.
- Hybrid scoring: per-query, retrieve top-10 from BM25 + top-10 from dense, RRF-fuse to top-K=3.
- Index rebuild on `config/knowledge-base.md` change (drift mitigation per §7.4); rebuild also on PR merge that adds a new migration.

**Success metric:** MAP@3 ≥ 0.75; first-attempt SHIP IT rate +10 pp over Phase 1 baseline.

**Exit criteria for Phase 4:** Dense alone doesn't surface paraphrase queries (e.g., a brand-new framework input that has no lexical overlap with prior corpus).

**Concrete Phase 3 deliverables:**

- New `scripts/embed-plans.ts` — Voyage-API path (default) and Transformers.js path (`VOYAGE_OFFLINE=1` flag). Writes/updates `outputs/.rag.lance` table `plans (id TEXT PRIMARY KEY, framework TEXT, vector FLOAT[3072], verdict TEXT, kb_ids TEXT, body_excerpt TEXT, rules_sha TEXT, last_surfaced_at TEXT)`.
- `scripts/retrieval-hybrid.ts` — replaces `retrieval-bm25.ts` at the call site; runs BM25 + dense in parallel; outputs RRF-fused top-K.
- `npm run check:rag-quality` — leave-one-out MAP@3 evaluator over the now-larger corpus; pre-commit hook if MAP@3 drops by > 5 pp PR-over-PR.
- Voyage cost dashboard — separate from Anthropic cost, since billing surface differs.

### Phase 4 — Full hybrid + reranker (Option D) — conditional, target: post-v1.0 quarter

**Ships (only if Phase 3 exit criteria met AND corpus ≥ 100 migrations):**

- Add `cross-encoder/ms-marco-MiniLM-L-6-v2` reranker via Transformers.js.
- Per-input cross-framework retrieval enabled (currently Phase 1 filters to same-framework; Phase 4 trusts the reranker to filter).
- Cross-corpus retrieval evaluated against public Playwright corpora (subject to NG3 rethink at that point).

**Success metric:** MAP@3 ≥ 0.85; first-attempt SHIP IT rate ≥ 70% (v1.0 gate hit).

**Concrete Phase 4 deliverables:**

- `scripts/retrieval-rerank.ts` — wraps the cross-encoder; cap rerank pool at top-20 from fused retrieval to keep query latency under 1 s.
- Public-corpus retrieval opt-in: `outputs/.rag-external.lance` reads from a curated, license-checked snapshot of Playwright official docs + a hand-picked set of `awesome-playwright` repos. Indexed separately; weight halved relative to internal corpus.
- Decision-record updates: NG3 (cross-project retrieval) is the lever Phase 4 trips; this ADR explicitly notes that flipping NG3 requires a follow-up ADR.

### Phase 5 — Operational hardening (target: ongoing)

- Quarterly retrieval-quality audit: run held-out MAP@3 over each new batch of 10 migrations, regress on quarter-over-quarter delta.
- PII-scrubbing pass on indexed plans (§7.3): re-run `scripts/test-stage0.ts` secret-scan over every newly indexed document; quarantine and refuse to index any doc that trips.
- Eviction policy: cap index size at 500 docs; LRU evict by `lastSurfacedAt`.
- Cross-validate retrieval quality against verify verdict trend: if `selectorQualityScore` improves on retrieved-from migrations but `web_first_rate` regresses, dig into the prompt — the retrieved example may be teaching one good lesson and one bad lesson, and we need a per-axis attribution.
- Periodic "no-retrieval" canary runs (one per fortnight, env-var-flagged) to detect retrieval-dependency creep — if Sonnet has silently learned to lean on retrieved examples for things the static prompt should cover, the canary surfaces it as a regression.

---

## 7. Risks + mitigations

### 7.1 Bad-example contamination (top risk)

**Risk:** Retrieval surfaces a plan whose verdict was FIX FIRST or START OVER (or never went through verify) and Sonnet treats it as canonical. The new plan inherits the bad pattern. Worse, retrieved BAD plans become *more likely* to be retrieved next time (the pollution compounds).

**Mitigation:**

- **Hard filter at index time:** only `outputs/reports/*.md` verdicts of SHIP IT (or unverified-but-golden, i.e., in `examples/`) are indexed. FIX FIRST and START OVER are excluded.
- **Per-retrieval audit log:** the retrieval output records WHICH plans were retrieved + their verdicts. Reviewer can spot a bad retrieval pattern in `npm run dashboard`.
- **Manual quarantine:** add a `outputs/.rag-quarantine.txt` file (one path per line) the index step honours. Reviewer can blacklist a plan with one commit.
- **Phase 2+ verdict-weighting:** even within SHIP IT, plans that got auto-merged without reviewer comment get higher weight than ones that needed a comment thread.
- **Per-retrieval reviewer veto:** the retrieval output ships as `outputs/reports/<basename>-rag.json` on the plan PR; a reviewer can comment `/rag-reject <retrieved-id>` (handled by a new branch of `regenerate-dispatch.yml`) to add the ID to quarantine and re-trigger Stage 1 without that document.
- **Symptom-based smoke check:** as part of the Phase 1 calibration, we add a fixture where the retrieval is *forced* to surface a plan that contains a known anti-pattern (a synthetic "bad" plan in `tools/calibrate-pipeline/fixtures/rag-bm25/contamination/`). Stage 1 must STILL produce a clean plan — i.e., the static prompt must dominate the retrieved bad example. If it doesn't, retrieval is a net negative regardless of measured MAP@3.

### 7.2 Cost runaway

**Risk:** Retrieval inflates Stage 1 prompts indefinitely as the corpus grows. K=3 today, K=5 tomorrow, K=10 next quarter, suddenly each migration costs $1+.

**Mitigation:**

- **Hard token budget:** `scripts/rag-context-render.ts` enforces a max-tokens-per-injection cap (default 5K, configurable). At K=3 + median plan excerpt of 1.5K tokens, we sit ~half-budget. Cap fires before the prompt grows.
- **Cost dashboard:** `outputs/.metrics.db` already tracks per-migration USD via `scripts/extract-claude-usage.ts`. Add a "RAG-attributed delta" column — alert if 7-day average exceeds $0.10 / migration Stage 1.
- **CI fail on exceeded budget:** `migrate.yml` and `plan.yml` reject runs exceeding $1 USD per migration (currently informational; promote to hard at Phase 2).
- **Per-K calibration:** Phase 1 calibration measures the marginal benefit of K=1 vs K=3 vs K=5 retrievals. If K=1 captures 80% of K=5's benefit at 33% of the cost, K=1 becomes the default.
- **Cap-by-tokens-not-by-K:** the retrieval interface honours `--max-context-tokens 5000` as the binding constraint; K is the soft target. If the top-1 retrieval is huge, we may inject only top-1 even though K=3 was requested.

### 7.3 Privacy — PII / credentials in indexed plans

**Risk:** A migrated test contained a real email + password in the input; the plan markdown faithfully cites the literal credentials. Indexing that plan stores those credentials in `outputs/.rag-index.json`. Embedding-API options (Voyage / OpenAI) would also send those credentials over the wire.

**Mitigation:**

- **Stage 0 secret scan reused at index time:** `scripts/test-stage0.ts` already detects AWS, Stripe, GitHub PAT, Slack, Anthropic, OpenAI tokens. `scripts/index-plans.ts` runs the same scan over every candidate plan and *refuses to index* on a hit (logs the rejection for reviewer).
- **PII redaction pass:** before indexing, regex-strip email-like strings, then BM25 the redacted form. Original plan on disk is unchanged; index sees the redacted variant.
- **No external embedding API in Phase 1 or Phase 2:** Phase 1 is local BM25, Phase 2 still local. Phase 3's Voyage API path is gated behind explicit `VOYAGE_API_KEY` opt-in + a `docs/adr/` follow-up sign-off documenting what leaves the repo.
- **`.gitignore` entry:** `outputs/.rag-index.json` is committed (for CI determinism + audit) only after secret-scan pass; otherwise quarantined and uncommitted.
- **Dangerfile rule:** add a 7th rule to `dangerfile.ts` (current 6) that blocks any PR whose diff under `outputs/.rag-index.json` contains a secret-scan match.
- **Index entries record an `originating_pr_url`** so a reviewer can trace any indexed text back to its source PR + commit; reduces "where did this come from" investigation time.

### 7.4 Drift — qa-master rule evolution invalidates old examples

**Risk:** `config/migration-rules.md` and `config/knowledge-base.md` evolve. A plan from 3 months ago still uses the old POM-extraction threshold or cites a renamed KB-ID. Retrieval surfaces the stale plan; Sonnet replicates the deprecated pattern.

**Mitigation:**

- **Index records the `config/migration-rules.md` + `config/knowledge-base.md` git SHA** the plan was generated under. Retrieval scoring multiplies by a decay factor `exp(-Δrev × 0.1)` where Δrev = number of intervening config-edit commits.
- **Auto-blacklist on rules-version mismatch:** if a plan was generated under a rules SHA that is no longer the head SHA AND the diff touches the cited KB IDs, the plan is excluded from retrieval until reviewer manually re-blesses it.
- **`config/kb-id-migration.md` already exists** (alias table for the old `KB-N.N.N` → new `<fw>/<topic>/<name>` rename — see `README.md`). The index honours the alias table when comparing KB IDs across rev boundaries.
- **Quarterly re-index audit:** prune plans whose rules-SHA is > 6 months old.
- **CI integration:** `regression-test.yml` matrix adds a "RAG index freshness" check — fails if more than 30% of indexed plans are > 90 days stale relative to current `config/` SHA.
- **Reviewer-friendly drift surface:** dashboard adds a "stale RAG entries" widget showing which indexed plans were generated under deprecated rules; reviewer can mass-quarantine with a single PR.

### 7.5 Debuggability — "why did Sonnet produce that?" gets harder

**Risk:** With static prompts, the prompt is the prompt; "why this output" is "read the prompt." With retrieval, every migration has a *different* prompt; "why this output" requires reconstructing exactly what was retrieved. If retrieval is a black box, the pipeline becomes harder to debug, not easier.

**Mitigation:**

- **Retrieval is deterministic** (BM25 over a stable index; Phase 3+ embedding model versions are pinned). Given the same input file + index SHA, retrieval is reproducible.
- **Every retrieval emits an audit JSON:** `outputs/reports/<basename>-rag.json` lists retrieved IDs, scores, source-of-match (which query token hit which document term). Joined to the trajectory tracer (`scripts/trajectory-trace.ts`).
- **`scripts/stage1-replay.ts` already supports SHA-256 caching of (input + prompt + feedback).** Extend cache key to include retrieval-output SHA. A reviewer can replay a migration with the exact retrieval that was used.
- **Shadow mode (Phase 1) lets us measure WITHOUT injecting**, so we can ship retrieval logging weeks before retrieval injection — building reviewer familiarity with the artifact before relying on it.
- **Snapshot the prompt actually sent.** `plan.yml` already pipes the assembled prompt through `tee` for Claude usage capture; extend that to also write `outputs/.last-prompt-stage1.txt` (gitignored), so a reviewer debugging a weird output can read the EXACT prompt Claude saw including the retrieved block. Sister capability for Stage 2 in Phase 2.

---

## 7a. Measurement protocol — how we know Phase 1 worked

The ADR claims BM25 retrieval reduces Stage 1 variance. We MUST measure that before promoting Phase 1 to a long-running default. The protocol below is the only artefact reviewer + maintainer will use to argue for or against advancing to Phase 2.

### 7a.1 Baseline capture (before Phase 1 PR merges)

- Run `scripts/semantic-regression-check.ts` with N=5 samples against each of the 6 inputs currently in `inputs/bad-playwright/` (the v0.5 quality bar corpus). Record per-axis mean + stddev to `outputs/.metrics.db` under `rag_mode='baseline'`.
- Snapshot `outputs/.metrics.db` to `outputs/.metrics.db.pre-rag` and commit (one-off allow in `.gitignore` exclusion).
- Record current cache-hit fraction from `scripts/extract-claude-usage.ts` over the same N=30 invocations (6 inputs × 5 samples).

### 7a.2 Shadow-mode capture (Phase 1 ships with STAGE1_RAG=shadow)

- Run same 6 inputs × N=5 samples with `STAGE1_RAG=shadow`. Retrieval runs and writes `outputs/reports/<basename>-rag.json` per migration, but the rendered context is NOT injected. Plan-quality metrics should be statistically indistinguishable from baseline (sanity check that shadow mode is truly no-op).
- Manually review the 30 `-rag.json` audit files. Goal: ≥ 80% of shadow-mode retrievals are "plausible" by reviewer judgement (i.e., a same-framework or same-anti-pattern-overlap plan in top-3). If shadow retrieval is already bad, BM25 needs tuning before live mode is enabled.

### 7a.3 Live-mode capture (the actual A/B)

- Flip `STAGE1_RAG=on` for the 3 inputs whose shadow-mode retrieval looked best (preserve the 3 worst as a control to surface "retrieval makes bad-retrieval-targets worse" failure modes).
- N=5 samples per input. Record per-axis mean + stddev.
- **Primary metric:** stddev reduction on `antiPatternTotal` and `selectorQualityHistogram` axes vs baseline. Target ≥ 1 stddev drop on at least 2 of the 5 axes.
- **Secondary metric:** absolute mean shift on `selectorQualityScore` — target ≥ +0.05.
- **Cost metric:** per-migration USD via `extract-claude-usage.ts` — target ≤ 1.5× baseline. If cost grows > 2×, force a K reduction.
- **Cache-hit metric:** target ≥ 50% cache-hit fraction maintained. Below 50% means we're sending too much dynamic content; tune the budget cap.

### 7a.4 Decision gate

After 6 inputs × 5 samples × 2 modes = 60 invocations (~$3 total Sonnet spend at baseline; ~$5 with retrieval cost overhead), reviewer + maintainer review the data **together**. Three possible outcomes:

1. **GO** — primary + secondary metrics hit. Promote `STAGE1_RAG=on` as the default. Phase 2 unblocked.
2. **TUNE** — primary metric hits on some axes but not others. Two iterations of k1/b/K parameter tuning permitted before next decision.
3. **STOP** — neither primary nor secondary metric hits, or cost grew > 2×. Revert default to `STAGE1_RAG=off`. Re-examine the design before committing further effort. Specifically question: are we retrieving from the wrong corpus? Should we have retrieved expected-OUTPUT spec files instead of expected-PLAN markdown?

### 7a.5 Anti-Goodhart guardrails

Variance is the metric, but variance is gameable (we could trivially shrink stddev to zero by retrieving the exact same example every time and forcing Sonnet into a single mode). We mitigate Goodhart by:

- Requiring variance reduction to come WITHOUT a regression on KB-ID coverage. If retrieved-mode plans cite fewer KB IDs than baseline plans, retrieval is suppressing genuine signal, not reducing noise.
- Requiring variance reduction to coexist with *retrieval diversity* — across 30 retrievals, at least 5 distinct documents must appear in top-3 outputs. If retrieval collapses to a single dominant example, we've over-tuned.
- Requiring variance reduction to not push selector quality DOWN. Sonnet may converge by ignoring per-input DOM evidence in favour of retrieved patterns; this would manifest as selector-quality regression. If we see it, STOP.

---

## 8. Alternatives considered + dropped

1. **Fine-tune Sonnet on our corpus.** Dropped: Anthropic does not expose a fine-tune endpoint for Sonnet 4.6 / 4.7. Even if available, the corpus is too small for SFT to outperform in-context learning (literature consensus: SFT wins above ~10K examples; we have 26).
2. **Vector retrieval over arbitrary public Playwright corpora (GitHub, npm, Playwright docs).** Dropped per NG3: too noisy, no quality control, license complexity, drift outside our control. Re-eval candidate post-v1.0 only after our own corpus is exhausted as a quality lever.
3. **Use the existing snippet inventory as the Stage 1 retrieval.** Dropped: the inventory captures EXISTING qa-master helpers (POMs, fixtures), not past PLANS. Different artifact, different purpose. Phase 2 *extends* the inventory grain to plans, but the inventory itself stays Stage 2's.
4. **Retrieve via Claude's web-search tool / Claude Code SDK tool-calling.** Dropped per NG2: introduces tool-call non-determinism into Stage 1, breaking the cache and the SHA-256 replay path. Phase 1 retrieval happens *before* the LLM call by design — the LLM sees a static augmented prompt, not a tool surface.
5. **Rolling-window summarisation (retrieve a single Claude-summarised digest of the last 10 migrations instead of K verbatim plans).** Dropped: the summarisation pass itself is an LLM call (~$0.05 per refresh), and the summary's lossiness defeats the point — the value of a retrieved plan is in its specific locator table and pin shape, not in a paraphrase. Re-considered for Phase ≥ 4 if context-budget pressure becomes the binding constraint.
6. **Per-framework hand-curated reference plans (5 per framework, ~20 total) instead of retrieval.** Dropped: this is Option A scaled up. The maintenance burden (per-quarter human curation of 20 reference plans across 4 frameworks) consumes more reviewer attention than Phase 1's BM25 in steady state.
7. **Retrieve only the LOCATOR TABLES, not full plans.** Dropped as an *exclusive* option but adopted as a Phase 1 secondary mode (`--retrieve locator-table-only` flag): when the input is dominated by locator-translation work, retrieving full plans is over-spend; when it's dominated by anti-pattern detection, full plans win. Phase 1 default is full plans; the flag lets us A/B.

---

## 9. References

1. Anthropic prompt caching docs — *Caching and reuse* (Anthropic, 2025) — https://docs.claude.com/en/docs/build-with-claude/prompt-caching — basis for Stage 1's existing static-prefix cache at 0.1× input price, and the prompt-prefix architecture this ADR's Phase 1 inherits.
2. Aider repo-map design — *How aider scans your repo* (Paul Gauthier / Aider, 2024) — https://aider.chat/docs/repomap.html — the inspiration for `scripts/build-inventory.ts` and a direct stylistic precedent for compact, signature-only retrieval surfaces over full file bodies.
3. ColBERT v2 — *Efficient and Effective Passage Search via Contextualized Late Interaction over BERT* (Khattab + Zaharia, SIGIR 2020) — https://arxiv.org/abs/2004.12832 — the canonical reference for the BM25-vs-dense gap analysis cited in §5.2 counter-arguments; ColBERTv2 is the model class the Phase 3 dense overlay would target if we ever ship local dense.
4. BEIR benchmark — *BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models* (Thakur et al., NeurIPS 2021) — https://arxiv.org/abs/2104.08663 — the source of the "dense wins at corpus size ≥ 1,000" empirical claim driving §4.5 and Phase 3 gating.
5. LanceDB — *Lance: A modern columnar data format for ML* (LanceDB, 2024) — https://lancedb.github.io/lancedb/ — Phase 3 vector-DB candidate; Node-native binding is the deciding criterion over sqlite-vss.
6. sqlite-vss — *Vector similarity search for SQLite* (Alex Garcia, 2023) — https://github.com/asg017/sqlite-vss — alternative Phase 3 vector store; rejected in §4.3 pros/cons due to C-extension Node-binding maturity.
7. Sourcegraph Cody architecture — *How Cody understands your codebase* (Sourcegraph, 2024) — https://sourcegraph.com/blog/how-cody-understands-your-codebase — the "context retrieval before LLM call" pattern Phase 1 imitates; Cody's retrieval-then-prompt shape generalises to our use case.
8. Cline RAG implementation reference — *Cline (formerly Claude Dev)* — https://github.com/cline/cline — open-source agent that ships explicit retrieval-augmented context pre-LLM-call; useful as an existence proof for the architecture and a reference for the dense-overlay path.
9. Google FSE 2025 — *Migrating Code At Scale With LLMs At Google* — https://arxiv.org/abs/2504.09691 — already cited in `README.md`; relevant here as the source of the "36% pure-LLM-landed" rate Phase 1's variance-reduction target benchmarks against.
10. arXiv 2410.10628 — *Test smells in LLM-generated unit tests* — https://arxiv.org/abs/2410.10628 — the 99.85% Magic-Number-Test smell figure motivating few-shot grounding; cited in `README.md` and re-used here as the variance-reduction lever.
11. NVIDIA RULER — *RULER: What's the Real Context Size of Your Long-Context Language Models?* (Hsieh et al., 2024) — https://arxiv.org/abs/2404.06654 — basis for the "62K Stage 1 prompt sits well below RULER cliff" claim in §3.1.
12. Reciprocal Rank Fusion — *Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods* (Cormack et al., SIGIR 2009) — https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf — Phase 4 hybrid scoring math.
13. Voyage AI embeddings — *voyage-code-3 model card* — https://docs.voyageai.com/docs/embeddings — Phase 3 preferred embedding model; code-specialised, 32K context, $0.18/M.
14. Transformers.js / Xenova — *Run 🤗 Transformers in your browser/Node* — https://huggingface.co/docs/transformers.js — Phase 3 local-fallback embedding path.
15. wink-bm25-text-search — *In-memory BM25 implementation for Node* — https://winkjs.org/wink-bm25-text-search/ — Phase 1 reference (we may inline rather than depend).
16. LPW Planning-Driven Programming — https://arxiv.org/abs/2411.14503 — already cited in `README.md`; the envelope-as-contract architecture the retrieval pipeline preserves end-to-end.
17. arXiv 2506.02943 — CANDOR multi-agent consensus — already cited in `README.md`; verify-stage architecture that retrieval at Stage 1 must not break.

---

## Appendix A — Quick-look Phase 1 PR checklist

- [ ] `scripts/index-plans.ts` — walks plans + examples, writes `outputs/.rag-index.json` with SHA-256 cache header.
- [ ] `scripts/retrieval-bm25.ts` — BM25 query path; reads index; writes top-K to `outputs/.rag-context.md`.
- [ ] `scripts/rag-context-render.ts` — markdown formatter w/ token-budget cap.
- [ ] `prompts/_fragments/few-shot-canonical.md` — 3 static anchors.
- [ ] `prompts/_fragments/rag-context.md` — dynamic include marker.
- [ ] `prompts/_assembled/analyze.md` — re-assembled with new fragments (via `npm run assemble-prompts`).
- [ ] `.github/workflows/plan.yml` — wiring step after Stage 0 + before `claude --print`.
- [ ] `outputs/.metrics.db` migration: `rag_retrieved_ids TEXT, rag_score REAL, rag_mode TEXT` on `plans` table.
- [ ] `scripts/dashboard.ts` panel: per-migration retrieval audit.
- [ ] 6 calibration fixtures in `tools/calibrate-pipeline/fixtures/rag-bm25/`.
- [ ] 1 entry in `ROADMAP.md` v0.5 section pointing here.
- [ ] `npm run smoke` clean.

**Files we will NOT touch in Phase 1:** `examples/reference/qa-master/` (verbatim anchor, off-limits per `CLAUDE.md`), `dangerfile.ts` (rule 7 lands in Phase 2 only), `outputs/helper/page-object/{basepage,baseblock}.ts` (committed scaffolding). Phase 1 stays inside `scripts/`, `prompts/_fragments/`, `.github/workflows/plan.yml`, and `tools/calibrate-pipeline/fixtures/`.

**Operator interface for Phase 1:**

```bash
# Build/refresh the retrieval index
npm run rag:index            # ./scripts/index-plans.ts → outputs/.rag-index.json

# Run retrieval against a specific input (locally, for debugging)
npm run rag:query -- inputs/bad-playwright/silent-conditionals.spec.ts

# Run the leave-one-out evaluator over the 17 golden examples
npm run rag:eval             # exit 1 if MAP@3 < 0.6

# Run the calibration fixtures (6 cases)
npm run calibrate            # already exists; rag-bm25/ fixtures auto-discovered
```

The 4 new scripts compose with the existing `npm run` interface; no new orchestration layer.

---

## Appendix B — Worked example: what a Phase 1 retrieval looks like for a real input

This appendix shows, end-to-end, what the retrieval pipeline does for one specific input. It is the concrete artefact reviewer + maintainer will see in `outputs/reports/<basename>-rag.json` after Phase 1 ships. The example uses `inputs/bad-playwright/silent-conditionals.spec.ts` as the query.

### B.1 The input query

```typescript
// inputs/bad-playwright/silent-conditionals.spec.ts (simplified)
import { test, expect } from '@playwright/test';

test('cart shows item when added', async ({ page }) => {
  await page.goto('/cart');
  if (await page.locator('.cart-empty-banner').isVisible()) {
    console.log('cart empty, skipping');
    return;
  }
  expect(await page.locator('.cart-row').count()).toBeGreaterThan(0);
});
```

### B.2 Query construction (Phase 1)

`scripts/retrieval-bm25.ts` builds a query from:

- **Source framework token** (high IDF weight): `bad-playwright`
- **File-extension hint**: `spec.ts`
- **Stage-0-style anti-pattern fingerprint regex hits**: `if-as-test-skip`, `console.log`, `sync-probe`, `cy.get`-style `locator(.css)`, `.cart-row`, `.cart-empty-banner`
- **Inferred KB-ID seeds** (derived from anti-pattern fingerprint via a lookup table in `scripts/index-plans.ts`): `KB-1.1.12` (conditional-in-test), `KB-1.1.5` (sync-probe), `KB-1.1.3` (CSS-class selector)

Query string (after tokenization): `bad-playwright spec.ts if-as-test-skip console.log sync-probe css-class-selector cart-row cart-empty-banner kb-1.1.12 kb-1.1.5 kb-1.1.3`

### B.3 BM25 scoring across 24 retrieval-eligible documents

Top-5 results (hypothetical scores from the leave-one-out evaluator; actual numbers from real corpus once Phase 1 ships):

| Rank | Doc ID                                                            | Score | Same framework? | KB-ID overlap |
|------|-------------------------------------------------------------------|-------|-----------------|---------------|
| 1    | `examples/bad-playwright-03-silent-conditionals/expected-plan.md` | 8.42  | Yes             | 3 / 3         |
| 2    | `outputs/plans/flaky-waits.spec.ts.md`                            | 5.71  | Yes             | 1 / 3         |
| 3    | `examples/bad-playwright-01-flaky-waits/expected-plan.md`         | 5.14  | Yes             | 1 / 3         |
| 4    | `examples/cypress-05-conditional-and-jquery/expected-plan.md`     | 4.32  | No (cross-fw)   | 2 / 3         |
| 5    | `outputs/plans/checkout-flow.cy.js.md`                            | 3.87  | No (cross-fw)   | 1 / 3         |

Top-3 (K=3 default): the canonical "silent conditionals" golden example wins by a wide margin (it is literally the prototype for this anti-pattern category), with two flaky-waits plans rounding out the context. This is exactly what we want.

### B.4 Rendered context block (sent to Sonnet)

```markdown
<!-- include-begin: rag-context -->
## Retrieved past migrations (Phase 1 BM25, top 3)

These are the 3 most similar past migrations. Use them as a guide for confidence calibration,
structural decisions, and pin shape. Do NOT copy-paste their locator tables — your input has
different locators. Your job is to apply their REASONING SHAPE to your own input.

### Retrieval 1 — examples/bad-playwright-03-silent-conditionals/expected-plan.md
- **Source framework:** bad-playwright (same as your input)
- **Verdict:** GOLDEN
- **KB IDs cited:** KB-1.1.12, KB-1.1.5, KB-1.1.3 (3/3 overlap with your input)
- **Anti-pattern table excerpt:**
  | Line | Snippet | KB-ID | Fix |
  | 4 | if (await locator.isVisible()) {...} | KB-1.1.12 | Replace conditional with `await expect(locator).toBeVisible()` |
  | 5 | console.log('skipping') | KB-1.1.3 (forbidden) | Delete; tests log via test reporter, not stdout |
- **Hallucination-defense pin shape:** all pins for this migration are LOW or N/A because the
  conditional removal is mechanical and doesn't require role inference.

### Retrieval 2 — outputs/plans/flaky-waits.spec.ts.md  [SHIP IT]
... (truncated to budget)

### Retrieval 3 — examples/bad-playwright-01-flaky-waits/expected-plan.md
... (truncated to budget)

<!-- include-end: rag-context -->
```

The renderer always emits the framework match, verdict, KB-ID overlap, and one or two table-excerpt rows per retrieval — NOT the full retrieved plan. The full plan stays on disk at the cited path; Sonnet can read it via the Read tool if it chooses (but the prompt asks it not to except for the top-1 match).

### B.4a Comparison: what Sonnet sees TODAY (Phase 0 baseline) for the same input

Today, the same input file produces a Stage 1 invocation where the prompt is the assembled `analyze.md` (~9K tokens) + KB + rules + qa-master anchor (~52K tokens cacheable) + the input itself (~0.5K tokens). Nothing about prior `silent-conditionals` migrations is in the context. Sonnet must:

- Rediscover that `if (await locator.isVisible()) { return }` is `KB-1.1.12 conditional-in-test` from the KB alone.
- Decide independently whether `console.log` is forbidden (yes — `prompts/_fragments/forbidden-patterns.md` says so, but Sonnet has to remember to apply it).
- Choose a confidence level for `.cart-row` from scratch (it has no past plan to anchor against).

The per-attempt variance shows up as different ordering of the anti-pattern table rows, different prose framing of the same KB-IDs, occasionally a mis-cited KB-ID that requires reviewer fix. Phase 1 retrieval injects the three above rows as `Retrieval 1 — examples/bad-playwright-03-silent-conditionals/expected-plan.md` worked example: now Sonnet has a labelled "here is what the canonical answer looks like" anchor PLUS the static prompt PLUS the input. The cost is ~1.8K extra tokens; the benefit is anchored-variance.

### B.5 Per-retrieval audit JSON

```json
{
  "input": "inputs/bad-playwright/silent-conditionals.spec.ts",
  "stage": 1,
  "rag_mode": "on",
  "query_terms": ["bad-playwright", "spec.ts", "if-as-test-skip", "console.log", "sync-probe", "css-class-selector", "cart-row", "cart-empty-banner", "kb-1.1.12", "kb-1.1.5", "kb-1.1.3"],
  "index_sha": "abc123...",
  "rules_sha_at_query": "def456...",
  "results": [
    {"id": "examples/bad-playwright-03-silent-conditionals/expected-plan.md", "score": 8.42, "framework": "bad-playwright", "verdict": "golden", "kb_overlap": ["KB-1.1.12", "KB-1.1.5", "KB-1.1.3"]},
    {"id": "outputs/plans/flaky-waits.spec.ts.md", "score": 5.71, "framework": "bad-playwright", "verdict": "n/a-real-plan", "kb_overlap": ["KB-1.1.5"]},
    {"id": "examples/bad-playwright-01-flaky-waits/expected-plan.md", "score": 5.14, "framework": "bad-playwright", "verdict": "golden", "kb_overlap": ["KB-1.1.5"]}
  ],
  "rendered_token_count": 1842,
  "budget_token_cap": 5000,
  "elapsed_ms": 23
}
```

This JSON is the reviewer's primary debugging surface. If a migration produces a weird plan, reviewer reads the audit JSON first, looks at what was retrieved, and decides whether the retrieval was wrong (quarantine) or the plan was wrong (regenerate without retrieval via `STAGE1_RAG=off`).

---

## Appendix C — Why a worktree-isolated `docs/adr/` numbering convention starts at 0001

This is the first ADR. Numbering starts at `0001-` (zero-padded to 4 digits) to match the Michael Nygard original ADR convention (https://github.com/joelparkerhenderson/architecture-decision-record). Future ADRs increment monotonically (`0002-…`, `0003-…`) and do not skip numbers even on rejected proposals; rejection is recorded in the ADR's `Status` field. This keeps git history searchable and avoids the "ADR-7 references the now-deleted ADR-4" footgun.

---

## Appendix D — What this ADR explicitly does NOT decide

To keep the decision surface narrow, here are the open questions Phase 1 does NOT settle. They each merit their own follow-up ADR:

1. **Should the retrieval re-rank Stage 1 outputs at REVIEW time?** I.e., when a reviewer sees a generated plan, should the system surface "here are the 3 past plans most similar to THIS NEW PLAN's text, in case you want to compare"? This is a different UX — retrieval-at-review-time vs retrieval-at-generate-time — and out of scope. Possible ADR 0002.
2. **Should the verify CANDOR sub-agents (SDET + Code Review Opus calls) also receive retrieved context?** Plausible — Opus is more expensive per call, so the cost-vs-benefit is different. Out of scope for ADR 0001; the verify prompts are already large and adding retrieval may push them past the cache-friendly prefix limit.
3. **Should retrieval be a first-class input to Stage 0 (input-rejection / triage)?** E.g., "this input is so similar to a past START OVER case that we should refuse before paying Sonnet to plan it." Plausible but premature — we don't have enough START OVER cases yet to retrieve meaningfully.
4. **Multi-modal retrieval — should we also retrieve based on DOM snapshots (Phase 6 playwright-mcp integration)?** Plausible at Phase 4+; the DOM snapshot is just text and BM25 / dense indexes can include it. Out of scope until DOM grounding ships its LLM-side ingestion.
5. **Cross-repo retrieval — should we share the index across PWmodernizer instances?** No instances exist outside the canonical one. Out of scope until v2.0 distribution conversation.
6. **Should the retrieval pipeline expose itself as an MCP server** the user can query interactively in their IDE? Speculative; out of scope.

---

## Appendix E — Anti-pattern catalog for ADR-writers (meta)

If you write the next ADR, avoid these failure modes — they are the ones an LLM-drafted ADR routinely commits and they would invalidate the document:

1. **"X is best practice" with no measured evidence.** Best practice is a citation, not an assertion.
2. **"We will use Z because Z is industry-standard."** Standardness is not a reason; quantified fit-for-purpose is.
3. **Symmetric pros/cons tables** where every option has the same number of bullets in each column. The asymmetry IS the decision; force the bullets to reflect reality, not aesthetics.
4. **"Phase 1 is feasible in a sprint" with no day-by-day breakdown.** If you cannot list which day delivers which artefact, you don't know whether the sprint is feasible.
5. **No measurable success criterion.** "Improves quality" is not a criterion; "reduces stddev of axis X by ≥ 1 over N=5 samples on corpus Y" is.
6. **Burying the decision.** The TL;DR at the top must state the recommended option, the gate to revisit, and the 1-week-Phase-1 commitment in the first paragraph. If a busy reviewer skims only that paragraph, they have what they need.

---

## Appendix F — Phase 1 rollback playbook

If Phase 1 ships and the measurement protocol (§7a) returns STOP, the rollback steps are:

1. **Flip the default env var**: set `STAGE1_RAG=off` repo-wide via `gh variable set STAGE1_RAG --body off`. Stage 1 immediately reverts to pre-Phase-1 prompt behaviour. No code change needed.
2. **Quarantine the rollback decision in the metrics DB**: add a row to a new `pipeline_decisions` table (or annotate the existing dashboard) recording the date, the measurement summary, and the reason.
3. **Open a follow-up ADR (0002) explaining what we learned.** Even if Phase 1 didn't ship its intended lift, the leave-one-out evaluation + variance measurement IS a learning. ADR 0002 captures: which retrieval queries failed, which axes didn't move, whether the failure was "retrieval was bad" vs "retrieval was good but Sonnet ignored it."
4. **Do NOT delete the retrieval code.** Keep it; ship it dark. Future Phase 2 (or an alternative Option C dense direction) may reuse the index-build, the audit JSON shape, the calibration fixtures, the dashboard panel. Even if the BM25 scoring path is wrong, ~70% of Phase 1's code surface stays useful.
5. **Restore baseline metrics** as the canonical comparison line for future retrieval experiments: tag the `outputs/.metrics.db.pre-rag` snapshot as the authoritative pre-RAG baseline. Future RAG experiments compare against this snapshot, not against running CI.

Rollback total elapsed time target: < 1 hour from STOP decision to fully-reverted pipeline.

---

## Appendix G — Glossary

| Term | Definition (in this ADR's scope) |
|------|----------------------------------|
| BM25 | Best Match 25; classical IR scoring formula (Robertson + Walker 1994). Inline implementation per §4.2. |
| Dense embedding | Real-valued vector representation of a text via a neural model; cosine similarity used for retrieval. |
| Hybrid retrieval | Run BM25 + dense in parallel, fuse rank lists; literature-standard for ≥ 1,000 docs. |
| MAP@K | Mean Average Precision at K; standard IR quality metric for "did the right doc appear in top-K." |
| RRF | Reciprocal Rank Fusion; fusion heuristic for combining multiple rank lists, no training required. |
| Shadow mode | Retrieval runs but does NOT inject into the prompt; output is logged for measurement only. |
| Cross-encoder reranker | Small model that scores (query, doc) pairs jointly; used at Phase 4 to rerank top-K from retrieval. |
| Verdict-weighting | Up-weighting retrieved plans whose verify verdict was SHIP IT (positive label). |
| Subtractive migration | A bad-Playwright source that needs hygiene cleanup, not framework translation. Envelope's `subtractive: true`. |
| Hallucination-defense pin | Numbered fallback contract in the plan for each MED/LOW-confidence locator. Stage 2 reads these literally. |
| Stage 0 / 1 / 2 / verify | Pipeline stages: sanity gate / plan / generate / dual-CANDOR review. |
| qa-master | The v0.2.0 production-grade layered architecture target output. `examples/reference/qa-master/`. |
| Snippet inventory | `outputs/.snippets-inventory.md`; existing POMs/fixtures/helpers Stage 2 sees pre-Claude. Pattern precedent for retrieval. |
| Trajectory tracer | `scripts/trajectory-trace.ts`; walks input → plan → envelope → code → verify, emits decision JSON. |
| Plan envelope | JSON sidecar to the markdown plan; machine-validatable contract Stage 2 reads first. |
| Cache-hit fraction | Share of input tokens served from Anthropic's prompt cache; the cost-lever for static prefix content. |

---

> *End of ADR 0001.*
