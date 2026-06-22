# RAG Phase 1 - BM25 over past migrations

Phase 1 implementation of [ADR-0001](adr/0001-self-improvement-rag.md).
Plain BM25 retrieval over indexed plan markdowns, no embeddings, no vector
DB. Goal: measure variance reduction on Stage 1 plans before any heavier
infrastructure lands.

## Pipeline

```
                +-----------------+
inputs/* -----> | index-plans.ts  | -----> outputs/.rag-index.json
plans/*  ----^  +-----------------+        (24 docs at v0.3 ship)
examples/* --^

                +------------------+
input file ---> | retrieval-bm25.ts| -----> outputs/.rag-context.json
                +------------------+        (top-K results)

                +------------------+
results.json -> | rag-context-render -----> prompts/_fragments/rag-context.md
                +------------------+        (markdown for prompt injection)
```

## Operator commands

| Command | When |
| --- | --- |
| `npm run rag:index` | After ingesting new plans into `outputs/plans/` or `examples/*/expected-plan.md` (31 docs as of 2026-06-22: outputs 15, examples 16) |
| `npm run rag:retrieve -- --input <path>` | Dry-run retrieval against a specific input file |
| `npm run rag:render -- --results <path>` | Format BM25 results as markdown |
| `npm run rag:map3` | Held-out MAP@3 over the golden corpus (signal-only report) |
| `npm run rag:eval` | The same MAP@3 as a **gate** — exits non-zero on HOLD (mirrors the CI `rag-map3-gate`). Run after editing the KB or corpus. |

## CI integration (next PR)

Phase 1 foundation ships the index + retrieval + render scripts and the
static few-shot anchors at `prompts/_fragments/few-shot-canonical.md`.
The plan.yml wiring (call retrieval after Stage 0 sanity gate, inject the
rendered markdown into the assemble-prompts include before `claude --print`)
is a follow-up PR. The env var contract:

| `STAGE1_RAG` | Behaviour |
| --- | --- |
| `off` (default) | Pre-Phase-1 behaviour. `prompts/_fragments/rag-context.md` stays empty, no extra tokens. |
| `shadow` | Retrieval runs, writes results to `outputs/reports/<basename>-rag.json` for measurement, but the rag-context.md fragment stays empty (Sonnet doesn't see it). |
| `on` | Retrieval runs and the rendered markdown is injected into the analyze.md prompt prefix. |

Shadow mode is the staging ground for measuring the Phase 1 success metric
before flipping any real migration to live retrieval.

## Index schema

`outputs/.rag-index.json` (versioned, SHA-256 cached):

```jsonc
{
  "version": 1,
  "generatedAt": "ISO8601",
  "sourceHash": "sha256",
  "documents": [
    {
      "id": "AddCookiesJupiterTest.java",         // or "examples/<dir>"
      "source": "outputs" | "examples",
      "sourceFramework": "bad-playwright" | "cypress" | "selenium-java" | "selenium-python" | "unknown",
      "verdict": "SHIP IT" | "FIX FIRST" | "START OVER" | "unknown",
      "kbIds": ["KB-1.1.1", "..."],
      "locatorConfidence": { "HIGH": 3, "MED": 1, "LOW": 2 },
      "planBody": "... (capped at 8 KB)",
      "planPath": "outputs/plans/<basename>.md"
    }
  ]
}
```

## Retrieval contract

`scripts/retrieval-bm25.ts`:

- Query construction: framework hint from input file extension +
  filename tokens + anti-pattern fingerprint (regex over the input body
  matching common framework idioms: `waitForTimeout`, `Thread.sleep`,
  `cy.intercept`, `WebDriverWait`, etc).
- Filter: candidates must have `verdict === "SHIP IT"` OR
  `source === "examples"` (goldens count as ships).
- Scoring: BM25 with k1=1.5, b=0.75 (Lucene defaults). IDF uses
  Robertson-style `log((N - df + 0.5) / (df + 0.5) + 1)`.
- Same-input dedup: a plan retrieving itself is excluded.
- Returns top-K (default 3) sorted by score desc.

## Measurement (Phase 1 exit criteria)

Per ADR-0001 §6:

- Held-out MAP@3 ≥ 0.6 over the 17 golden examples (leave-one-out).
- Shadow→on lift ≥ +0.05 absolute on `selectorQualityScore`
  OR -1 stddev on the variance axis.
- No regression on `npm run smoke` or `regression-test.yml`.
- Per-migration USD cost stays under $0.07 for Stage 1.

The measurement harness (semantic-regression-check N=5 shadow vs N=5 on)
lands in the follow-up wiring PR.

### Honest MAP@3 status (2026-06-22)

The held-out **MAP@3 is 0.868** over the 31-doc corpus — a PASS (≥ 0.6), and now
an *honest* number. It was previously reported as 0.931, but that figure was
inflated by a **train/test leak**: the per-query token vector was built from the
held-out doc's GOLD plan (`framework` + `kbIds`), while `isRelevant` scores on
shared KB-IDs — so the query was leaking the ground-truth labels. The query now
mirrors production (framework + tokens *earned* by running the fingerprint
catalogue over the raw input body; never `doc.kbIds`). The drop from 0.931 → 0.868
is the leak being removed, not a regression — retrieval is genuinely good.

**What is still UNMEASURED:** the production shadow→on **uplift** (does injecting
the retrieved plans actually lower Stage-1 variance / raise selector quality?).
That is the one remaining RAG step and it requires real token-spending runs
(`STAGE1_RAG=shadow` baseline vs `STAGE1_RAG=on`, N≥5 each). Retrieval *quality*
is proven and gated; retrieval *value in production* is not yet measured. Keep
`STAGE1_RAG=off` as the default until that A/B is run with a human present.

## What's NOT in this PR

- `plan.yml` wiring (follow-up PR; gated by env-var contract above)
- `outputs/.metrics.db` schema migration to track `rag_retrieved_ids`,
  `rag_score`, `rag_mode` (follow-up)
- 6 calibration fixtures under
  `tools/calibrate-pipeline/fixtures/rag-bm25/` (follow-up)
- Dashboard "RAG retrieval" panel (follow-up)

This PR is the foundation only. The follow-up PR wires it into production
Stage 1 + measurement; both ship within the 1-week sprint per ADR.
